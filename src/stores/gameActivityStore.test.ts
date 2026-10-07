import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeAccountId: "account-a" as string | null,
  settings: { enabled: true, publishEnabled: true, games: [] },
  gameDetectionGetSettings: vi.fn(),
  gameDetectionScan: vi.fn(),
  gameDetectionSetPublishEnabled: vi.fn(),
  gatewaySetGameActivity: vi.fn(),
}));

vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: { getState: () => ({ activeAccountId: mocks.activeAccountId }) },
}));

vi.mock("@/lib/tauri", () => ({
  gameDetectionGetSettings: mocks.gameDetectionGetSettings,
  gameDetectionScan: mocks.gameDetectionScan,
  gameDetectionSetPublishEnabled: mocks.gameDetectionSetPublishEnabled,
  gatewaySetGameActivity: mocks.gatewaySetGameActivity,
}));

import { useGameActivityStore } from "./gameActivityStore";

const game = {
  id: "valorant",
  name: "VALORANT",
  executable: "VALORANT-Win64-Shipping.exe",
  processId: "1234",
  startedAt: 1_700_000_000_000,
};

describe("direct game presence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeAccountId = "account-a";
    mocks.gameDetectionGetSettings.mockResolvedValue({ ...mocks.settings });
    mocks.gameDetectionScan.mockResolvedValue(game);
    mocks.gameDetectionSetPublishEnabled.mockImplementation(async (enabled: boolean) => ({ ...mocks.settings, publishEnabled: enabled }));
    mocks.gatewaySetGameActivity.mockResolvedValue(undefined);
    useGameActivityStore.setState({
      settings: { ...mocks.settings },
      detectedGame: null,
      published: null,
      readyAccountIds: ["account-a", "account-b"],
      replayAccountIds: [],
      error: null,
    });
  });

  it("publishes on the selected account without calling Discord Desktop RPC", async () => {
    await useGameActivityStore.getState().refreshAndSync(game);

    expect(mocks.gatewaySetGameActivity).toHaveBeenCalledExactlyOnceWith("account-a", {
      name: "VALORANT",
      startedAt: game.startedAt,
    });
    expect(useGameActivityStore.getState().published).toEqual({
      accountId: "account-a",
      signature: `valorant:1234:${game.startedAt}:VALORANT`,
    });
  });

  it("clears the previous account before publishing on the newly selected account", async () => {
    await useGameActivityStore.getState().refreshAndSync(game);
    mocks.gatewaySetGameActivity.mockClear();
    mocks.activeAccountId = "account-b";

    await useGameActivityStore.getState().refreshAndSync(game);

    expect(mocks.gatewaySetGameActivity.mock.calls).toEqual([
      ["account-a", null],
      ["account-b", { name: "VALORANT", startedAt: game.startedAt }],
    ]);
  });

  it("clears the activity when publication is disabled", async () => {
    await useGameActivityStore.getState().refreshAndSync(game);
    mocks.gatewaySetGameActivity.mockClear();

    await useGameActivityStore.getState().setPublishingEnabled(false);

    expect(mocks.gatewaySetGameActivity).toHaveBeenCalledExactlyOnceWith("account-a", null);
    expect(useGameActivityStore.getState().published).toBeNull();
  });

  it("waits for the account connection and removes the presence when the game closes", async () => {
    useGameActivityStore.setState({ readyAccountIds: [] });
    await useGameActivityStore.getState().refreshAndSync(game);
    expect(mocks.gatewaySetGameActivity).not.toHaveBeenCalled();

    useGameActivityStore.getState().onGatewayStatus("account-a", "connected");
    await useGameActivityStore.getState().refreshAndSync(game);
    expect(mocks.gatewaySetGameActivity).toHaveBeenCalledWith("account-a", {
      name: "VALORANT",
      startedAt: game.startedAt,
    });

    mocks.gatewaySetGameActivity.mockClear();
    await useGameActivityStore.getState().refreshAndSync(null);
    expect(mocks.gatewaySetGameActivity).toHaveBeenCalledExactlyOnceWith("account-a", null);
    expect(useGameActivityStore.getState().published).toBeNull();
  });

  it("resends the game after the active account reconnects", async () => {
    await useGameActivityStore.getState().refreshAndSync(game);
    mocks.gatewaySetGameActivity.mockClear();

    useGameActivityStore.getState().onGatewayStatus("account-a", "reconnecting");
    await useGameActivityStore.getState().refreshAndSync(game);
    useGameActivityStore.getState().onGatewayStatus("account-a", "connected");
    await useGameActivityStore.getState().refreshAndSync(game);

    const calls = mocks.gatewaySetGameActivity.mock.calls;
    expect(calls[calls.length - 1]).toEqual([
      "account-a",
      { name: "VALORANT", startedAt: game.startedAt },
    ]);
  });

  it("clears stale game presence if the game closes during reconnection", async () => {
    await useGameActivityStore.getState().refreshAndSync(game);
    mocks.gatewaySetGameActivity.mockClear();
    mocks.gameDetectionScan.mockResolvedValue(null);

    useGameActivityStore.getState().onGatewayStatus("account-a", "reconnecting");
    useGameActivityStore.getState().onGatewayStatus("account-a", "connected");
    await useGameActivityStore.getState().refreshAndSync(null);

    expect(mocks.gatewaySetGameActivity).toHaveBeenCalledWith("account-a", null);
    expect(useGameActivityStore.getState().published).toBeNull();
  });
});

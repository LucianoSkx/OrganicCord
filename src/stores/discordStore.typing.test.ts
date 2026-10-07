import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getMessages: vi.fn() }));
vi.mock("@/lib/tauri", () => api);
import { useDiscordStore } from "./discordStore";
import { accountCacheKey } from "@/lib/messageCache";

describe("typing state", () => {
  beforeEach(() => {
    useDiscordStore.getState().clearCache("account");
    useDiscordStore.getState().clearCache("other-account");
    api.getMessages.mockReset();
  });

  it("keeps events received during a channel transition for the channel being opened", () => {
    const store = useDiscordStore.getState();
    store.activateMessageChannel("account", "current-channel");
    store.addTypingUser("account", "next-channel", "user", Date.now());

    expect(useDiscordStore.getState().cache.typingUsers[accountCacheKey("account", "next-channel")])
      .toEqual([{ userId: "user", timestamp: expect.any(Number), member: undefined }]);

    store.activateMessageChannel("account", "next-channel");
    expect(useDiscordStore.getState().cache.typingUsers[accountCacheKey("account", "next-channel")])
      .toHaveLength(1);
  });

  it("refreshes duplicate users and removes expired events on the next update", () => {
    const store = useDiscordStore.getState();
    store.addTypingUser("account", "dm", "stale-user", Date.now() - 11_000);
    store.addTypingUser("account", "dm", "active-user", Date.now());
    store.addTypingUser("account", "dm", "active-user", Date.now() + 1);

    expect(useDiscordStore.getState().cache.typingUsers[accountCacheKey("account", "dm")])
      .toEqual([{ userId: "active-user", timestamp: expect.any(Number), member: undefined }]);
  });

  it("isolates typing events by account and ignores invalid timestamps", () => {
    const store = useDiscordStore.getState();
    store.addTypingUser("account", "dm", "user", Date.now());
    store.addTypingUser("other-account", "dm", "user", Number.NaN);

    expect(useDiscordStore.getState().cache.typingUsers[accountCacheKey("account", "dm")]).toHaveLength(1);
    expect(useDiscordStore.getState().cache.typingUsers[accountCacheKey("other-account", "dm")]).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordMessage } from "@/types";

const api = vi.hoisted(() => ({ addReaction: vi.fn(), removeReaction: vi.fn() }));
vi.mock("@/lib/tauri", () => api);

import { useDiscordStore } from "./discordStore";

const message = (): DiscordMessage => ({
  id: "reaction-test-message",
  channel_id: "reaction-test-channel",
  content: "Olá",
  author: { id: "user", username: "user", discriminator: "0", avatar: null },
  timestamp: "2026-10-07T00:00:00.000Z",
  edited_timestamp: null,
  attachments: [],
  embeds: [],
  reactions: [],
});

describe("custom reaction lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.addReaction.mockResolvedValue(undefined);
    api.removeReaction.mockResolvedValue(undefined);
    useDiscordStore.setState((state) => ({
      cache: { ...state.cache, messages: { "account:reaction-test-channel": [message()] } },
    }));
  });

  it("renders a custom reaction by ID and merges its gateway echo", async () => {
    const store = useDiscordStore.getState();
    await store.addReaction("account", "reaction-test-channel", "reaction-test-message", "wave:123456789012345678");
    expect(api.addReaction).toHaveBeenCalledWith("account", "reaction-test-channel", "reaction-test-message", "wave:123456789012345678");

    store.applyGatewayReaction("account", "reaction-test-channel", "reaction-test-message", { id: "123456789012345678", name: "wave", animated: true }, true, true);
    expect(useDiscordStore.getState().cache.messages["account:reaction-test-channel"][0].reactions).toEqual([
      { count: 1, me: true, emoji: { id: "123456789012345678", name: "wave", animated: true } },
    ]);

    await store.removeReaction("account", "reaction-test-channel", "reaction-test-message", "wave:123456789012345678");
    expect(useDiscordStore.getState().cache.messages["account:reaction-test-channel"][0].reactions).toEqual([]);
  });
});

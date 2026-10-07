import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordMessage } from "@/types";
import { accountCacheKey, CACHED_CHANNEL_LIMIT, INACTIVE_MESSAGE_LIMIT, LIVE_MESSAGE_LIMIT } from "@/lib/messageCache";

const api = vi.hoisted(() => ({ getMessages: vi.fn() }));
vi.mock("@/lib/tauri", () => api);
import { useDiscordStore } from "./discordStore";

function message(id: number): DiscordMessage {
  return { id: String(id), channel_id: "channel", author: { id: "user", username: "user", discriminator: "0", avatar: null },
    content: `Message ${id}`, timestamp: new Date(id * 1000).toISOString(), edited_timestamp: null, attachments: [], embeds: [], pinned: false };
}
describe("message cache and recovery", () => {
  beforeEach(() => {
    useDiscordStore.getState().clearCache("account");
    useDiscordStore.getState().clearCache("other");
    api.getMessages.mockReset();
  });
  it("does not retain unopened history but retains active messages", () => {
    const store = useDiscordStore.getState();
    for (let id = 1; id <= 1000; id++) store.prependMessage("account", "unopened", message(id));
    expect(useDiscordStore.getState().cache.messages["account:unopened"]).toBeUndefined();
    store.activateMessageChannel("account", "channel");
    for (let id = 1; id <= 650; id++) store.prependMessage("account", "channel", message(id));
    expect(useDiscordStore.getState().cache.messages["account:channel"]).toHaveLength(LIVE_MESSAGE_LIMIT);
  });
  it("bounds inactive channels and preserves manually loaded history while reading", () => {
    const store = useDiscordStore.getState();
    for (let channel = 0; channel < 18; channel++) {
      store.activateMessageChannel("account", String(channel));
      for (let id = 1; id <= 101; id++) store.prependMessage("account", String(channel), message(id));
    }
    const entries = Object.entries(useDiscordStore.getState().cache.messages).filter(([key]) => key.startsWith("account:"));
    expect(entries.length).toBeLessThanOrEqual(CACHED_CHANNEL_LIMIT);
    expect(entries.filter(([key]) => key !== "account:17").every(([, items]) => items.length <= INACTIVE_MESSAGE_LIMIT)).toBe(true);
    store.setHistoryExpanded("account", "17", true);
    for (let id = 102; id <= 750; id++) store.prependMessage("account", "17", message(id));
    expect(useDiscordStore.getState().cache.messages["account:17"]).toHaveLength(750);
    store.setHistoryExpanded("account", "17", false);
    expect(useDiscordStore.getState().cache.messages["account:17"]).toHaveLength(LIVE_MESSAGE_LIMIT);
  });
  it("recovers more than one page and deduplicates concurrent recovery", async () => {
    const store = useDiscordStore.getState();
    store.activateMessageChannel("account", "channel");
    store.prependMessage("account", "channel", message(1));
    api.getMessages.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => message(i + 2)))
      .mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => message(i + 52)))
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => message(i + 12)));
    await Promise.all([store.recoverMessages("account", "channel"), store.recoverMessages("account", "channel")]);
    expect(api.getMessages).toHaveBeenCalledTimes(3);
    expect(api.getMessages).toHaveBeenNthCalledWith(2, "account", "channel", undefined, "51");
    expect(useDiscordStore.getState().cache.messages["account:channel"]).toHaveLength(61);
  });
  it("recovers edits and deletions in the recent window without periodic polling", async () => {
    const store = useDiscordStore.getState();
    store.activateMessageChannel("account", "channel");
    store.prependMessage("account", "channel", message(100));
    store.prependMessage("account", "channel", message(101));
    api.getMessages.mockResolvedValueOnce([message(102)])
      .mockResolvedValueOnce([message(102), { ...message(100), content: "Edited while offline" }]);
    await store.recoverMessages("account", "channel");
    const messages = useDiscordStore.getState().cache.messages["account:channel"];
    expect(messages.map((item) => item.id)).toEqual(["102", "100"]);
    expect(messages[1].content).toBe("Edited while offline");
  });
  it("deduplicates pagination and remembers the end of history", async () => {
    const store = useDiscordStore.getState();
    store.activateMessageChannel("account", "channel");
    store.prependMessage("account", "channel", message(100));
    api.getMessages.mockResolvedValue([message(99)]);
    await Promise.all([store.fetchMoreMessages("account", "channel"), store.fetchMoreMessages("account", "channel")]);
    await store.fetchMoreMessages("account", "channel");
    expect(api.getMessages).toHaveBeenCalledTimes(1);
  });
  it("keeps accounts isolated and ignores responses after removal", async () => {
    const store = useDiscordStore.getState();
    store.activateMessageChannel("other", "channel");
    store.prependMessage("other", "channel", message(900));
    store.activateMessageChannel("account", "channel");
    let resolve!: (items: DiscordMessage[]) => void;
    api.getMessages.mockReturnValue(new Promise<DiscordMessage[]>((done) => { resolve = done; }));
    const request = store.fetchMessages("account", "channel");
    await Promise.resolve();
    store.clearCache("account");
    resolve([message(100)]);
    await request;
    expect(useDiscordStore.getState().cache.messages[accountCacheKey("account", "channel")]).toBeUndefined();
    expect(useDiscordStore.getState().cache.messages["other:channel"][0].id).toBe("900");
  });
});

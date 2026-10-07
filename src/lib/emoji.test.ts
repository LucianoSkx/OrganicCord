import { describe, expect, it } from "vitest";
import { customEmojiCode, findCustomEmoji, listCustomEmojiMatches, normalizeReactionEmoji, parseCustomEmojiToken, reactionIdentifier, resolveEmojiToken, sameReactionEmoji } from "./emoji";

const guilds = {
  first: [{ id: "123456789012345678", name: "wave", animated: false }],
  current: [
    { id: "223456789012345678", name: "wave", animated: true },
    { id: "323456789012345678", name: "smile", animated: false },
  ],
};

describe("custom emoji codes", () => {
  it("accepts Discord codes and the ID-first spelling", () => {
    expect(parseCustomEmojiToken("<:wave:123456789012345678>")).toEqual({ name: "wave", id: "123456789012345678", animated: false });
    expect(parseCustomEmojiToken("<a:wave:123456789012345678>")).toEqual({ name: "wave", id: "123456789012345678", animated: true });
    expect(parseCustomEmojiToken("<123456789012345678:wave:>")).toEqual({ name: "wave", id: "123456789012345678", animated: false });
    expect(parseCustomEmojiToken("<script>")).toBeNull();
  });

  it("resolves a typed name in the current server before other servers", () => {
    expect(findCustomEmoji("WAVE", guilds, "current")?.id).toBe("223456789012345678");
    expect(resolveEmojiToken(":smile:", guilds, "current")?.id).toBe("323456789012345678");
    expect(resolveEmojiToken(":missing:", guilds, "current")).toBeNull();
    expect(customEmojiCode(resolveEmojiToken(":wave:", guilds, "current")!)).toBe("<a:wave:223456789012345678>");
    expect(listCustomEmojiMatches("w", guilds, "current")).toHaveLength(1);
  });

  it("keeps one identity for local reactions and gateway events", () => {
    const local = normalizeReactionEmoji({ id: null, name: "wave:123456789012345678" });
    const gateway = { id: "123456789012345678", name: null, animated: true };
    expect(local.id).toBe(gateway.id);
    expect(reactionIdentifier(local)).toBe("wave:123456789012345678");
    expect(sameReactionEmoji(local, gateway)).toBe(true);
    expect(normalizeReactionEmoji({ id: null, name: "🔥" })).toEqual({ id: null, name: "🔥" });
  });
});

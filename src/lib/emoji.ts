import type { DiscordEmoji, Reaction } from "@/types";

export type CustomEmoji = { id: string; name: string; animated: boolean };
type EmojiGroups = Record<string, DiscordEmoji[]> | null | undefined;

const catalogs = new WeakMap<object, Array<{ id: string; names: string[]; imgUrl: string }>>();
const EMPTY_CATALOG: Array<{ id: string; names: string[]; imgUrl: string }> = [];
export function emojiCatalog(groups: EmojiGroups) {
  if (!groups) return EMPTY_CATALOG;
  const existing = catalogs.get(groups);
  if (existing) return existing;
  const catalog = Object.values(groups).flat().filter((e) => e.id && e.available !== false).map((e) => ({
    id: e.id!, names: e.name ? [e.name] : [], imgUrl: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "webp"}?size=48`,
  }));
  catalogs.set(groups, catalog);
  return catalog;
}

export function parseCustomEmojiToken(value: string): CustomEmoji | null {
  const standard = /^<(a?):([\w-]+):(\d+)>$/.exec(value);
  if (standard) return { animated: standard[1] === "a", name: standard[2], id: standard[3] };

  // Accept the ID-first spelling too; outgoing messages still use Discord's format.
  const idFirst = /^<(\d+):([\w-]+):?>$/.exec(value);
  if (idFirst) return { animated: false, name: idFirst[2], id: idFirst[1] };
  return null;
}

export function findCustomEmoji(name: string, groups: EmojiGroups, preferredGuildId?: string | null): CustomEmoji | null {
  if (!groups) return null;
  const ordered = preferredGuildId
    ? [groups[preferredGuildId] ?? [], ...Object.entries(groups).filter(([id]) => id !== preferredGuildId).map(([, emojis]) => emojis)]
    : Object.values(groups);
  for (const emojis of ordered) {
    const match = emojis.find((emoji) => emoji.id && emoji.name?.toLowerCase() === name.toLowerCase() && emoji.available !== false);
    if (match?.id) return { id: match.id, name: match.name ?? name, animated: !!match.animated };
  }
  return null;
}

export function resolveEmojiToken(value: string, groups: EmojiGroups, preferredGuildId?: string | null): CustomEmoji | null {
  const explicit = parseCustomEmojiToken(value);
  if (explicit) return explicit;
  const shortcut = /^:([\w-]+):$/.exec(value);
  return shortcut ? findCustomEmoji(shortcut[1], groups, preferredGuildId) : null;
}

export function listCustomEmojiMatches(query: string, groups: EmojiGroups, preferredGuildId?: string | null): CustomEmoji[] {
  if (!groups || !query) return [];
  const ordered = preferredGuildId
    ? [groups[preferredGuildId] ?? [], ...Object.entries(groups).filter(([id]) => id !== preferredGuildId).map(([, emojis]) => emojis)]
    : Object.values(groups);
  const seen = new Set<string>();
  const matches: CustomEmoji[] = [];
  for (const emojis of ordered) {
    for (const emoji of emojis) {
      if (!emoji.id || !emoji.name?.toLowerCase().startsWith(query.toLowerCase()) || emoji.available === false) continue;
      if (seen.has(emoji.name.toLowerCase())) continue;
      seen.add(emoji.name.toLowerCase());
      matches.push({ id: emoji.id, name: emoji.name, animated: !!emoji.animated });
      if (matches.length === 6) return matches;
    }
  }
  return matches;
}

export function customEmojiCode(emoji: CustomEmoji): string {
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

/** Convert recognized shortcuts at the last possible moment before sending. */
export function serializeOutgoingEmojiTokens(content: string, groups: EmojiGroups, preferredGuildId?: string | null): string {
  return content.replace(/<a?:[\w-]+:\d+>|<\d+:[\w-]+:?>|:[\w-]+:/g, (token) => {
    const emoji = resolveEmojiToken(token, groups, preferredGuildId);
    return emoji ? customEmojiCode(emoji) : token;
  });
}

export function normalizeReactionEmoji(emoji: Reaction["emoji"]): Reaction["emoji"] {
  if (emoji.id) return emoji;
  const value = emoji.name ?? "";
  const parsed = parseCustomEmojiToken(value) ?? (() => {
    const shorthand = /^([\w-]+):(\d+)$/.exec(value);
    return shorthand ? { name: shorthand[1], id: shorthand[2], animated: false } : null;
  })();
  return parsed ? { id: parsed.id, name: parsed.name, animated: emoji.animated ?? parsed.animated } : emoji;
}

export function reactionIdentifier(emoji: Reaction["emoji"]): string {
  const normalized = normalizeReactionEmoji(emoji);
  return normalized.id ? `${normalized.name ?? "emoji"}:${normalized.id}` : normalized.name ?? "";
}

export function sameReactionEmoji(left: Reaction["emoji"], right: Reaction["emoji"]): boolean {
  const a = normalizeReactionEmoji(left);
  const b = normalizeReactionEmoji(right);
  return a.id && b.id ? a.id === b.id : !a.id && !b.id && a.name === b.name;
}

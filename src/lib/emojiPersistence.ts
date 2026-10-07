import type { DiscordEmoji } from "@/types";

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; read: () => Record<string, DiscordEmoji[]> | undefined }>();

function flush(accountId: string) {
  const entry = pending.get(accountId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(accountId);
  try {
    const value = entry.read();
    if (value) localStorage.setItem(`guildEmojis-${accountId}`, JSON.stringify(value));
  } catch { /* A full or unavailable cache must not interrupt the Gateway. */ }
}

export function scheduleEmojiPersistence(accountId: string, read: () => Record<string, DiscordEmoji[]> | undefined) {
  const previous = pending.get(accountId);
  if (previous) clearTimeout(previous.timer);
  pending.set(accountId, { read, timer: setTimeout(() => flush(accountId), 750) });
}

export function clearEmojiPersistence(accountId: string) {
  const entry = pending.get(accountId);
  if (entry) clearTimeout(entry.timer);
  pending.delete(accountId);
  try { localStorage.removeItem(`guildEmojis-${accountId}`); } catch { /* Optional cache. */ }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => [...pending.keys()].forEach(flush));
}

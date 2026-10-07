import type { DiscordMessage } from "@/types";

export const EMPTY_MESSAGES: DiscordMessage[] = [];
export const INACTIVE_MESSAGE_LIMIT = 100;
export const LIVE_MESSAGE_LIMIT = 600;
export const CACHED_CHANNEL_LIMIT = 12;

export function accountCacheKey(accountId: string, resourceId: string): string {
  return `${accountId}:${resourceId}`;
}

export interface MessagePage {
  lastAccess: number;
  hasMore: boolean;
  historyExpanded: boolean;
}

export function compareMessages(a: DiscordMessage, b: DiscordMessage): number {
  if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) {
    return a.id.length === b.id.length ? b.id.localeCompare(a.id) : b.id.length - a.id.length;
  }
  return Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

export function mergeMessages(current: DiscordMessage[], incoming: DiscordMessage[]): DiscordMessage[] {
  const confirmed = new Set(incoming.map((m) => `${m.author.id}:${m.content.trim()}`));
  const messages = new Map(current
    .filter((m) => !m.id.startsWith("local-") || !confirmed.has(`${m.author.id}:${m.content.trim()}`))
    .map((m) => [m.id, m]));
  incoming.forEach((m) => messages.set(m.id, m));
  return [...messages.values()].sort(compareMessages);
}

export function pruneMessageCache(
  messages: Record<string, DiscordMessage[]>,
  pages: Record<string, MessagePage>,
  activeKey: string | null,
): string[] {
  for (const [key, list] of Object.entries(messages)) {
    const limit = key === activeKey ? (pages[key]?.historyExpanded ? Infinity : LIVE_MESSAGE_LIMIT) : INACTIVE_MESSAGE_LIMIT;
    if (list.length > limit) {
      const pending = list.filter((m) => m.id.startsWith("local-"));
      messages[key] = [...list.filter((m) => !m.id.startsWith("local-")).slice(0, limit), ...pending].sort(compareMessages);
      if (pages[key]) pages[key].hasMore = true;
    }
  }
  const inactive = Object.keys(messages).filter((key) => key !== activeKey)
    .sort((a, b) => (pages[b]?.lastAccess ?? 0) - (pages[a]?.lastAccess ?? 0));
  const evicted = inactive.slice(CACHED_CHANNEL_LIMIT - (activeKey && messages[activeKey] ? 1 : 0));
  for (const key of evicted) {
    delete messages[key];
    delete pages[key];
  }
  return evicted;
}

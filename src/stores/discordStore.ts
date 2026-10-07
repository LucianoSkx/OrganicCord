import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { 
  DiscordGuild, 
  DiscordChannel, 
  DiscordMessage, 
  DiscordDM, 
  DiscordRelationship, 
  DiscordPresence,
  DiscordEmoji,
  DiscordRole,
  DiscordMember,
  DiscordThread,
  DiscordGatewayGuild,
  Reaction,
} from "@/types";
import * as api from "@/lib/tauri";
import { checkMessageSendLimit, checkMessageDeleteLimit, checkReactionLimit } from "@/lib/rateLimiter";
import { accountCacheKey, mergeMessages, pruneMessageCache, type MessagePage } from "@/lib/messageCache";
import { scheduleEmojiPersistence, clearEmojiPersistence } from "@/lib/emojiPersistence";
import { normalizeReactionEmoji, sameReactionEmoji } from "@/lib/emoji";

export function normalizePresence(presence: DiscordPresence | null | undefined): { userId: string; normalized: DiscordPresence } | null {
  if (!presence?.user?.id) return null;
  const userId = presence.user.id;
  if (!userId) return null;

  const normalized: DiscordPresence = {
    user: {
      id: userId,
      username: presence.user?.username || "",
      discriminator: presence.user?.discriminator || "",
      avatar: presence.user?.avatar || null,
    },
    status: presence.status || "offline",
    activities: presence.activities || [],
    client_status: presence.client_status || {},
  };

  return { userId, normalized };
}

interface DiscordCache {
  guilds: Record<string, DiscordGuild[]>;         // accountId → guilds
  channels: Record<string, Record<string, DiscordChannel[]>>; // accountId → guildId → channels
  messages: Record<string, DiscordMessage[]>;     // channelId → messages
  dms: Record<string, DiscordDM[]>;               // accountId → DMs
  guildEmojis: Record<string, Record<string, DiscordEmoji[]>>; // accountId -> guildId -> emojis
  guildRoles: Record<string, Record<string, DiscordRole[]>>; // accountId -> guildId -> roles
  guildMembers: Record<string, Record<string, DiscordMember>>; // accountId -> guildId -> current member
  session_ids: Record<string, string>;            // accountId -> sessionId
  relationships: Record<string, DiscordRelationship[]>; // accountId → relationships
  presences: Record<string, Record<string, DiscordPresence>>; // accountId -> userId -> presence
  threads: Record<string, DiscordThread[]>;                 // guildId → threads
  pinnedMessages: Record<string, DiscordMessage[]>; // channelId -> pinned messages
  unreads: Record<string, Record<string, { count: number; mentions: number; guildId?: string }>>; // accountId -> channelId -> unread data
  typingUsers: Record<string, { userId: string; timestamp: number; member?: DiscordMember }[]>; // channelId -> users
}

interface LoadingState {
  guilds: Record<string, boolean>;
  messages: Record<string, boolean>;
  threads: Record<string, boolean>;
}

export type GuildChannelLoadStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface GuildChannelLoadState {
  status: GuildChannelLoadStatus;
  source?: "gateway" | "rest";
  requestId?: string;
  updatedAt?: number;
}

export function channelErrorKey(accountId: string, guildId: string): string {
  return `channels-${accountId}-${guildId}`;
}

function mergeChannels(
  current: readonly DiscordChannel[],
  incoming: readonly DiscordChannel[],
): DiscordChannel[] {
  const merged = new Map(current.map((channel) => [channel.id, channel]));
  incoming.forEach((channel) => {
    merged.set(channel.id, { ...merged.get(channel.id), ...channel });
  });
  return [...merged.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function normalizeGatewayChannel(value: unknown): DiscordChannel | null {
  const channel = value as Partial<DiscordChannel> & { type?: unknown };
  const channelType = Number(channel.channel_type ?? channel.type);
  if (typeof channel.id !== "string" || !Number.isFinite(channelType)) return null;
  return {
    ...channel,
    id: channel.id,
    name: typeof channel.name === "string" ? channel.name : null,
    channel_type: channelType,
    position: typeof channel.position === "number" ? channel.position : null,
    parent_id: typeof channel.parent_id === "string" ? channel.parent_id : null,
    topic: typeof channel.topic === "string" ? channel.topic : null,
    nsfw: typeof channel.nsfw === "boolean" ? channel.nsfw : null,
  } as DiscordChannel;
}

let channelRequestSequence = 0;

function nextChannelRequestId(accountId: string, guildId: string): string {
  channelRequestSequence += 1;
  return `${accountId}:${guildId}:${channelRequestSequence}`;
}

const messageRequests = new Map<string, Promise<void>>();
const accountEpochs = new Map<string, number>();
const epochFor = (accountId: string) => accountEpochs.get(accountId) ?? 0;
let reactionRevision = 0;
const reactionRevisions = new Map<string, number>();
const pendingReactionMutations = new Map<string, number>();

function reactionMessageKey(accountId: string, channelId: string, messageId: string): string {
  return `${accountCacheKey(accountId, channelId)}:${messageId}`;
}

function markReactionChanged(key: string): void {
  reactionRevisions.set(key, ++reactionRevision);
  if (reactionRevisions.size > 2_000) {
    const oldestKey = reactionRevisions.keys().next().value;
    if (oldestKey) reactionRevisions.delete(oldestKey);
  }
}

function beginReactionMutation(key: string): void {
  pendingReactionMutations.set(key, (pendingReactionMutations.get(key) ?? 0) + 1);
  markReactionChanged(key);
}

function endReactionMutation(key: string): void {
  const pending = pendingReactionMutations.get(key) ?? 0;
  if (pending <= 1) pendingReactionMutations.delete(key);
  else pendingReactionMutations.set(key, pending - 1);
}

function mergeFetchedMessages(
  key: string,
  current: DiscordMessage[],
  incoming: DiscordMessage[],
  startedAtRevision: number,
): DiscordMessage[] {
  const merged = mergeMessages(current, incoming);
  const currentById = new Map(current.map((message) => [message.id, message]));
  for (const message of merged) {
    const reactionKey = `${key}:${message.id}`;
    if (!pendingReactionMutations.has(reactionKey) && (reactionRevisions.get(reactionKey) ?? 0) <= startedAtRevision) continue;
    const currentMessage = currentById.get(message.id);
    if (currentMessage) message.reactions = currentMessage.reactions;
  }
  return merged;
}

function messageRequest(key: string, operation: () => Promise<void>): Promise<void> {
  const existing = messageRequests.get(key);
  if (existing) return existing;
  const request = Promise.resolve().then(operation).finally(() => {
    if (messageRequests.get(key) === request) messageRequests.delete(key);
  });
  messageRequests.set(key, request);
  return request;
}

interface DiscordStore {
  cache: DiscordCache;
  activeMessageKey: string | null;
  messagePages: Record<string, MessagePage>;
  activateMessageChannel: (accountId: string, channelId: string) => void;
  setHistoryExpanded: (accountId: string, channelId: string, expanded: boolean) => void;
  recoverMessages: (accountId: string, channelId: string) => Promise<void>;
  loading: LoadingState;
  channelLoads: Record<string, Record<string, GuildChannelLoadState>>;
  errors: Record<string, string>;

  setSessionId: (accountId: string, sessionId: string) => void;
  fetchGuilds: (accountId: string) => Promise<void>;
  fetchChannels: (accountId: string, guildId: string, force?: boolean) => Promise<void>;
  hydrateGuildFromGateway: (accountId: string, guild: DiscordGatewayGuild) => void;
  applyGuildChannelEvent: (
    accountId: string,
    guildId: string,
    channel: DiscordChannel,
    deleted: boolean,
  ) => void;
  fetchForumThreads: (accountId: string, channelId: string, guildId: string) => Promise<void>;
  fetchMessages: (accountId: string, channelId: string) => Promise<void>;
  fetchMoreMessages: (accountId: string, channelId: string) => Promise<void>;
  fetchDMs: (accountId: string) => Promise<void>;
  closeDM: (accountId: string, channelId: string) => Promise<void>;
  openDM: (accountId: string, userId: string) => Promise<string>;
  fetchRelationships: (accountId: string) => Promise<void>;
  fetchPinnedMessages: (accountId: string, channelId: string) => Promise<void>;
  pinMessage: (accountId: string, channelId: string, messageId: string) => Promise<void>;
  unpinMessage: (accountId: string, channelId: string, messageId: string) => Promise<void>;
  sendMessage: (accountId: string, channelId: string, content: string, replyTo?: string) => Promise<void>;
  editMessage: (accountId: string, channelId: string, messageId: string, content: string) => Promise<void>;
  deleteMessage: (accountId: string, channelId: string, messageId: string) => Promise<void>;
  sendMessageWithAttachment: (
    accountId: string,
    channelId: string,
    content: string,
    replyTo: string | undefined,
    fileName: string,
    fileHandle?: string,
    fileData?: Uint8Array
  ) => Promise<void>;
  sendVoiceMessage: (
    accountId: string,
    channelId: string,
    audioData: Uint8Array,
    durationSecs: number,
    waveform: string,
    replyTo?: string
  ) => Promise<void>;
  addReaction: (accountId: string, channelId: string, messageId: string, emoji: string) => Promise<void>;
  removeReaction: (accountId: string, channelId: string, messageId: string, emoji: string) => Promise<void>;
  prependMessage: (accountId: string, channelId: string, message: DiscordMessage) => void;
  updateMessageFromGateway: (accountId: string, channelId: string, message: Partial<DiscordMessage> & { id: string }) => void;
  removeMessageFromGateway: (accountId: string, channelId: string, messageId: string) => void;
  applyGatewayReaction: (
    accountId: string,
    channelId: string,
    messageId: string,
    emoji: Reaction["emoji"],
    added: boolean,
    isCurrentUser: boolean
  ) => void;
  addGuildEmojis: (accountId: string, guildId: string, emojis: DiscordEmoji[]) => void;
  addGuildRoles: (accountId: string, guildId: string, roles: DiscordRole[]) => void;
  addGuildMember: (accountId: string, guildId: string, member: DiscordMember) => void;
  updatePresence: (accountId: string, presence: DiscordPresence) => void;
  updatePresences: (accountId: string, presences: DiscordPresence[]) => void;
  incrementUnread: (accountId: string, channelId: string, hasMention: boolean, guildId?: string) => void;
  clearUnread: (accountId: string, channelId: string, messageId?: string) => Promise<void>;
  addTypingUser: (accountId: string, channelId: string, userId: string, timestamp: number, member?: DiscordMember) => void;
  clearCache: (accountId: string) => void;
  blockUser: (accountId: string, userId: string) => Promise<void>;
  unblockUser: (accountId: string, userId: string) => Promise<void>;
}

export function pruneDiscordMessageCache(s: Pick<DiscordStore, "cache" | "messagePages" | "activeMessageKey" | "loading" | "errors">) {
  for (const key of pruneMessageCache(s.cache.messages, s.messagePages, s.activeMessageKey)) {
    delete s.cache.pinnedMessages[key];
    delete s.cache.typingUsers[key];
    delete s.loading.messages[key];
    delete s.errors[`messages-${key}`];
  }
}

export const useDiscordStore = create<DiscordStore>()(
  immer((set, get) => ({
    cache: { 
      guilds: {}, 
      channels: {}, 
      messages: {}, 
      dms: {}, 
      guildEmojis: {}, 
      guildRoles: {},
      guildMembers: {},
      session_ids: {},
      relationships: {}, 
      presences: {}, 
      threads: {}, 
      pinnedMessages: {}, 
      unreads: {},
      typingUsers: {}
    },
    loading: { guilds: {}, messages: {}, threads: {} },
    channelLoads: {},
    errors: {},
    
    setSessionId: (accountId, sessionId) => {
      set((s) => {
        s.cache.session_ids[accountId] = sessionId;
      });
    },

    fetchGuilds: async (accountId) => {
      const epoch = epochFor(accountId);
      if (get().loading.guilds[accountId]) return;
      set((s) => { s.loading.guilds[accountId] = true; });
      try {
        const guilds = await api.getGuilds(accountId);
        if (epochFor(accountId) !== epoch) return;
        // Ordena por nome
        guilds.sort((a, b) => a.name.localeCompare(b.name));
        
        // Tenta carregar emojis cacheados
        try {
          const cachedEmojis = localStorage.getItem(`guildEmojis-${accountId}`);
          if (cachedEmojis) {
            set((s) => { s.cache.guildEmojis[accountId] = JSON.parse(cachedEmojis); });
          }
        } catch (e) {}

        set((s) => {
          s.cache.guilds[accountId] = guilds;
          s.loading.guilds[accountId] = false;
        });
      } catch (e) {
        if (epochFor(accountId) !== epoch) return;
        console.error("[discordStore] fetchGuilds failed:", e);
        set((s) => {
          s.errors[`guilds-${accountId}`] = String(e);
          s.loading.guilds[accountId] = false;
          // Garante que guilds não fique como undefined — mantém array vazio para re-tentar
          if (!s.cache.guilds[accountId]) s.cache.guilds[accountId] = [];
        });
      }
    },

    fetchChannels: async (accountId, guildId, force = false) => {
      const currentLoad = get().channelLoads[accountId]?.[guildId];
      if (!force && currentLoad?.status === "loading") return;

      const requestId = nextChannelRequestId(accountId, guildId);
      const startedAt = performance.now();
      const errorKey = channelErrorKey(accountId, guildId);
      console.info("[guild-content] channels_request_started", { accountId, guildId, requestId, force });
      set((s) => {
        if (!s.channelLoads[accountId]) s.channelLoads[accountId] = {};
        s.channelLoads[accountId][guildId] = {
          status: "loading",
          requestId,
          source: currentLoad?.source,
          updatedAt: currentLoad?.updatedAt,
        };
        delete s.errors[errorKey];
      });
      try {
        const [channels, member] = await Promise.all([
          api.getChannels(accountId, guildId),
          api.getCurrentGuildMember(accountId, guildId).catch((error) => {
            console.warn("[discordStore] current guild member unavailable:", error);
            return null;
          }),
        ]);
        // Subscribe to presences and members for this guild
        api.subscribeGuild(accountId, guildId).catch(console.error);
        
        let unreadState: Record<string, string> = {};
        try {
          unreadState = await api.invoke<Record<string, string>>("get_unread_state", { accountId });
        } catch (e) {
          console.error("Failed to load unread state", e);
        }

        // Ordena por posição
        channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        let responseCommitted = false;
        set((s) => {
          const activeRequest = s.channelLoads[accountId]?.[guildId]?.requestId;
          if (activeRequest !== requestId) {
            console.info("[guild-content] channels_response_discarded", {
              accountId,
              guildId,
              requestId,
              activeRequest,
            });
            return;
          }

          if (!s.cache.channels[accountId]) s.cache.channels[accountId] = {};
          const previous = s.cache.channels[accountId][guildId] ?? [];
          if (channels.length > 0 || previous.length === 0) {
            s.cache.channels[accountId][guildId] = channels;
          }
          if (member) {
            if (!s.cache.guildMembers[accountId]) s.cache.guildMembers[accountId] = {};
            s.cache.guildMembers[accountId][guildId] = member;
          }
          
          if (!s.cache.unreads[accountId]) s.cache.unreads[accountId] = {};
          
          for (const ch of channels) {
            const lastMsgId = ch.last_message_id;
            if (lastMsgId) {
              const readMsgId = unreadState[ch.id];
              try {
                // Convertendo para BigInt para comparar snowflake IDs corretamente
                const isUnread = !readMsgId || BigInt(readMsgId) < BigInt(lastMsgId);
                if (isUnread) {
                  if (!s.cache.unreads[accountId][ch.id]) {
                    s.cache.unreads[accountId][ch.id] = { count: 1, mentions: 0, guildId };
                  } else if (s.cache.unreads[accountId][ch.id].count === 0) {
                    s.cache.unreads[accountId][ch.id].count = 1;
                  }
                }
              } catch (_e) {
                // ID não numérico (ex: thread de fórum) — ignora silenciosamente
              }
            }
          }
          
          s.channelLoads[accountId][guildId] = {
            status: (channels.length > 0 || previous.length > 0) ? "ready" : "empty",
            source: channels.length > 0 ? "rest" : s.channelLoads[accountId][guildId].source,
            updatedAt: Date.now(),
          };
          delete s.errors[errorKey];
          responseCommitted = true;
        });
        if (responseCommitted) {
          console.info("[guild-content] channels_request_succeeded", {
            accountId,
            guildId,
            requestId,
            channelCount: channels.length,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }
      } catch (e) {
        let failureCommitted = false;
        set((s) => {
          const activeRequest = s.channelLoads[accountId]?.[guildId]?.requestId;
          if (activeRequest !== requestId) return;
          const previous = s.cache.channels[accountId]?.[guildId] ?? [];
          s.errors[errorKey] = String(e);
          s.channelLoads[accountId][guildId] = {
            status: previous.length > 0 ? "ready" : "error",
            source: s.channelLoads[accountId][guildId].source,
            updatedAt: s.channelLoads[accountId][guildId].updatedAt,
          };
          failureCommitted = true;
        });
        if (failureCommitted) {
          console.error("[guild-content] channels_request_failed", {
            accountId,
            guildId,
            requestId,
            durationMs: Math.round(performance.now() - startedAt),
            error: String(e),
          });
        }
      }
    },

    hydrateGuildFromGateway: (accountId, guild) => {
      if (guild.unavailable) {
        console.info("[guild-content] gateway_guild_unavailable", { accountId, guildId: guild.id });
        return;
      }

      const incoming = [...(guild.channels ?? []), ...(guild.threads ?? [])]
        .map(normalizeGatewayChannel)
        .filter((channel): channel is DiscordChannel => channel !== null);
      set((s) => {
        if (
          typeof guild.name === "string" &&
          typeof guild.owner === "boolean" &&
          typeof guild.permissions === "string"
        ) {
          if (!s.cache.guilds[accountId]) s.cache.guilds[accountId] = [];
          const guildIndex = s.cache.guilds[accountId].findIndex((item) => item.id === guild.id);
          const minimalGuild: DiscordGuild = {
            id: guild.id,
            name: guild.name,
            icon: guild.icon ?? null,
            owner: guild.owner,
            permissions: guild.permissions,
          };
          if (guildIndex >= 0) s.cache.guilds[accountId][guildIndex] = minimalGuild;
          else s.cache.guilds[accountId].push(minimalGuild);
        }

        if (incoming.length === 0) return;
        if (!s.cache.channels[accountId]) s.cache.channels[accountId] = {};
        s.cache.channels[accountId][guild.id] = mergeChannels(
          s.cache.channels[accountId][guild.id] ?? [],
          incoming,
        );
        if (!s.channelLoads[accountId]) s.channelLoads[accountId] = {};
        const activeRequest = s.channelLoads[accountId][guild.id]?.requestId;
        s.channelLoads[accountId][guild.id] = {
          status: "ready",
          source: "gateway",
          requestId: activeRequest,
          updatedAt: Date.now(),
        };
        delete s.errors[channelErrorKey(accountId, guild.id)];
      });
      if (incoming.length > 0) {
        console.info("[guild-content] channels_cache_committed", {
          accountId,
          guildId: guild.id,
          source: "gateway",
          channelCount: incoming.length,
        });
      }
    },

    applyGuildChannelEvent: (accountId, guildId, channel, deleted) => {
      set((s) => {
        if (!s.cache.channels[accountId]) s.cache.channels[accountId] = {};
        const current = s.cache.channels[accountId][guildId] ?? [];
        s.cache.channels[accountId][guildId] = deleted
          ? current.filter((item) => item.id !== channel.id)
          : mergeChannels(current, [channel]);
        if (!s.channelLoads[accountId]) s.channelLoads[accountId] = {};
        const activeRequest = s.channelLoads[accountId][guildId]?.requestId;
        s.channelLoads[accountId][guildId] = {
          status: s.cache.channels[accountId][guildId].length > 0 ? "ready" : "empty",
          source: "gateway",
          requestId: activeRequest,
          updatedAt: Date.now(),
        };
      });
      console.info("[guild-content] gateway_channel_committed", {
        accountId,
        guildId,
        channelId: channel.id,
        operation: deleted ? "delete" : "upsert",
      });
    },

    fetchForumThreads: async (accountId, channelId, guildId) => {
      const epoch = epochFor(accountId);
      if (!accountId || !channelId || !guildId) return;
      if (get().loading.threads[accountCacheKey(accountId, channelId)]) return;
      set((s) => { s.loading.threads[accountCacheKey(accountId, channelId)] = true; });
      try {
        const response = await api.getForumThreads(accountId, channelId, guildId);
        // Dependendo da estrutura de search, pode ter 'threads', 'posts', ou a array pode estar na raiz
        const threads = response.threads || (Array.isArray(response) ? response : []);
        if (epochFor(accountId) !== epoch) return;
        set((s) => {
          // Salvar threads na key do guildId, mas como não temos o guildId aqui facilmente,
          // podemos mapear por channelId? Wait! A cache.threads é Record<string, any[]>.
          // Vamos continuar usando cache.threads, mas salvar na key do channelId para simplificar o ForumArea.
          s.cache.threads[accountCacheKey(accountId, channelId)] = threads;
          s.loading.threads[accountCacheKey(accountId, channelId)] = false;
        });
      } catch (e) {
        if (epochFor(accountId) !== epoch) return;
        console.error(`[discordStore] Error fetching forum threads:`, e);
        set((s) => {
          s.errors[`threads-${accountCacheKey(accountId, channelId)}`] = String(e);
          s.loading.threads[accountCacheKey(accountId, channelId)] = false;
        });
      }
    },

    activeMessageKey: null,
    messagePages: {},
    activateMessageChannel: (accountId, channelId) => {
      const key = accountCacheKey(accountId, channelId);
      set((s) => {
        if (s.activeMessageKey && s.activeMessageKey !== key) delete s.cache.typingUsers[s.activeMessageKey];
        const now = Date.now();
        for (const typingKey of Object.keys(s.cache.typingUsers)) {
          const activeUsers = s.cache.typingUsers[typingKey].filter((user) => now - user.timestamp < 10_000);
          if (activeUsers.length) s.cache.typingUsers[typingKey] = activeUsers;
          else delete s.cache.typingUsers[typingKey];
        }
        s.activeMessageKey = key;
        s.messagePages[key] = { ...s.messagePages[key], lastAccess: Date.now(), hasMore: s.messagePages[key]?.hasMore ?? true, historyExpanded: false };
        pruneDiscordMessageCache(s);
      });
    },
    setHistoryExpanded: (accountId, channelId, expanded) => {
      const key = accountCacheKey(accountId, channelId);
      if (get().messagePages[key]?.historyExpanded === expanded) return;
      set((s) => {
        if (s.messagePages[key]) s.messagePages[key].historyExpanded = expanded;
        if (!expanded) pruneDiscordMessageCache(s);
      });
    },
    fetchMessages: (accountId, channelId) => {
      const key = accountCacheKey(accountId, channelId);
      const epoch = epochFor(accountId);
      const startedAtRevision = reactionRevision;
      return messageRequest(`${key}:recent`, async () => {
        if (epochFor(accountId) !== epoch) return;
        set((s) => { s.loading.messages[key] = true; });
        try {
          const messages = await api.getMessages(accountId, channelId);
          if (epochFor(accountId) !== epoch) return;
          set((s) => {
            s.cache.messages[key] = mergeFetchedMessages(key, s.cache.messages[key] ?? [], messages, startedAtRevision);
            s.messagePages[key] = { lastAccess: Date.now(), hasMore: messages.length >= 50, historyExpanded: false };
            pruneDiscordMessageCache(s);
            delete s.errors[`messages-${key}`];
          });
        } catch (e) {
          if (epochFor(accountId) === epoch) set((s) => { s.errors[`messages-${key}`] = String(e); });
        } finally {
          if (epochFor(accountId) === epoch) set((s) => { s.loading.messages[key] = false; });
        }
      });
    },
    recoverMessages: (accountId, channelId) => {
      const key = accountCacheKey(accountId, channelId);
      const epoch = epochFor(accountId);
      return messageRequest(`${key}:recover`, async () => {
        const initial = messageRequests.get(`${key}:recent`);
        if (initial) await initial;
        if (epochFor(accountId) !== epoch) return;
        const existing = get().cache.messages[key];
        let cursor = existing?.find((m) => /^\d+$/.test(m.id))?.id;
        if (!cursor) { await get().fetchMessages(accountId, channelId); return; }
        try {
          // Paginate the gap, not just its first 50 messages. Every page advances
          // the cursor even if its messages already arrived through the Gateway.
          while (epochFor(accountId) === epoch && get().activeMessageKey === key) {
            const fresh = await api.getMessages(accountId, channelId, undefined, cursor);
            if (epochFor(accountId) !== epoch || !get().cache.messages[key]) return;
            if (!fresh.length) break;
            const next = mergeMessages([], fresh).find((m) => /^\d+$/.test(m.id))?.id;
            set((s) => {
              s.cache.messages[key] = mergeMessages(s.cache.messages[key] ?? [], fresh);
              pruneDiscordMessageCache(s);
            });
            if (!next || BigInt(next) <= BigInt(cursor)) break;
            cursor = next;
            if (fresh.length < 50) break;
          }
          if (epochFor(accountId) !== epoch || get().activeMessageKey !== key) return;
          // Creation events cannot recover edits/deletions missed while offline.
          // Reconcile the recent window once per recovery, preserving older pages
          // and messages received through the Gateway during this request.
          const upper = get().cache.messages[key]?.find((message) => /^\d+$/.test(message.id))?.id;
          const recentReactionRevision = reactionRevision;
          const recent = await api.getMessages(accountId, channelId);
          if (epochFor(accountId) !== epoch || !get().cache.messages[key]) return;
          const sorted = mergeMessages([], recent);
          const numeric = sorted.filter((message) => /^\d+$/.test(message.id));
          const oldest = numeric[numeric.length - 1]?.id;
          const ids = new Set(recent.map((message) => message.id));
          set((s) => {
            const retained = s.cache.messages[key].filter((message) => {
              if (!/^\d+$/.test(message.id) || ids.has(message.id) || !upper) return true;
              return BigInt(message.id) > BigInt(upper) || (recent.length >= 50 && oldest !== undefined && BigInt(message.id) < BigInt(oldest));
            });
            s.cache.messages[key] = mergeFetchedMessages(key, retained, recent, recentReactionRevision);
            pruneDiscordMessageCache(s);
          });
          set((s) => { delete s.errors[`messages-${key}`]; });
        } catch (e) {
          if (epochFor(accountId) === epoch) set((s) => { s.errors[`messages-${key}`] = String(e); });
        }
      });
    },
    fetchMoreMessages: (accountId, channelId) => {
      const key = accountCacheKey(accountId, channelId);
      const epoch = epochFor(accountId);
      return messageRequest(`${key}:older`, async () => {
        if (epochFor(accountId) !== epoch) return;
        if (get().messagePages[key]?.hasMore === false) return;
        const oldest = [...(get().cache.messages[key] ?? [])].reverse().find((m) => /^\d+$/.test(m.id));
        if (!oldest) return;
        try {
          const older = await api.getMessages(accountId, channelId, oldest.id);
          if (epochFor(accountId) !== epoch || !get().cache.messages[key]) return;
          set((s) => {
            s.cache.messages[key] = mergeMessages(s.cache.messages[key] ?? [], older);
            s.messagePages[key] = { lastAccess: Date.now(), hasMore: older.length >= 50, historyExpanded: true };
            pruneDiscordMessageCache(s);
          });
        } catch (e) {
          if (epochFor(accountId) === epoch) set((s) => { s.errors[`messages-${key}`] = String(e); });
        }
      });
    },

    fetchDMs: async (accountId) => {
      const epoch = epochFor(accountId);
      try {
        const dms = await api.getDMs(accountId);
        if (epochFor(accountId) !== epoch) return;
        set((s) => { s.cache.dms[accountId] = dms; });
      } catch (e) {
        if (epochFor(accountId) !== epoch) return;
        set((s) => { s.errors[`dms-${accountId}`] = String(e); });
      }
    },

    closeDM: async (accountId, channelId) => {
      try {
        await api.closeDM(accountId, channelId);
        set((s) => {
          if (s.cache.dms[accountId]) {
            s.cache.dms[accountId] = s.cache.dms[accountId].filter(dm => dm.id !== channelId);
          }
        });
      } catch (e) {
        console.error("Erro ao fechar DM:", e);
      }
    },

    fetchPinnedMessages: async (accountId, channelId) => {
      const epoch = epochFor(accountId);
      try {
        const pins = await api.getPinnedMessages(accountId, channelId);
        if (epochFor(accountId) !== epoch) return;
        set((s) => { s.cache.pinnedMessages[accountCacheKey(accountId, channelId)] = pins; });
      } catch (e) {
        console.error("Erro ao buscar mensagens fixadas:", e);
      }
    },

    pinMessage: async (accountId, channelId, messageId) => {
      try {
        await api.pinMessage(accountId, channelId, messageId);
      } catch (e) {
        console.error("Erro ao fixar mensagem:", e);
      }
    },

    unpinMessage: async (accountId, channelId, messageId) => {
      try {
        await api.unpinMessage(accountId, channelId, messageId);
      } catch (e) {
        console.error("Erro ao desfixar mensagem:", e);
      }
    },

    openDM: async (accountId, userId) => {
      // 1. Verificar se a DM já existe no cache
      const dms = get().cache.dms[accountId] || [];
      const existingDM = dms.find(dm => 
        dm.channel_type === 1 && dm.recipients?.length === 1 && dm.recipients[0].id === userId
      );
      
      if (existingDM) {
        return existingDM.id;
      }

      // 2. Se não existir, chama API para criar/abrir DM
      try {
        const dm = await api.createDM(accountId, userId);
        set((s) => {
          if (!s.cache.dms[accountId]) s.cache.dms[accountId] = [];
          s.cache.dms[accountId].push(dm);
        });
        return dm.id;
      } catch (e) {
        console.error("Failed to open DM:", e);
        throw e;
      }
    },

    fetchRelationships: async (accountId) => {
      const epoch = epochFor(accountId);
      try {
        const [rels, presences] = await Promise.all([
          api.getRelationships(accountId),
          api.getGatewayPresences(accountId).catch(e => {
            console.error("Failed to get presences:", e);
            return [];
          })
        ]);
        if (epochFor(accountId) !== epoch) return;
        set((s) => { 
          s.cache.relationships[accountId] = rels; 
          if (!s.cache.presences[accountId]) {
            s.cache.presences[accountId] = {};
          }
          if (presences && Array.isArray(presences)) {
            for (const presence of presences) {
              const norm = normalizePresence(presence);
              if (norm) {
                const existing = s.cache.presences[accountId][norm.userId] || {};
                s.cache.presences[accountId][norm.userId] = {
                  ...existing,
                  ...norm.normalized,
                  user: { ...(existing.user || {}), ...norm.normalized.user },
                  client_status: { ...(existing.client_status || {}), ...norm.normalized.client_status },
                };
              }
            }
          }
        });
      } catch (e) {
        if (epochFor(accountId) !== epoch) return;
        console.error("fetchRelationships error:", e);
        set((s) => { s.errors[`relationships-${accountId}`] = String(e); });
      }
    },

    blockUser: async (accountId, userId) => {
      try {
        await api.blockUser(accountId, userId);
        set((s) => {
          const rels = s.cache.relationships[accountId] || [];
          const idx = rels.findIndex((r) => r.user.id === userId);
          if (idx !== -1) {
            rels[idx] = { ...rels[idx], relationship_type: 2 };
          } else {
            rels.push({
              id: userId,
              relationship_type: 2,
              nickname: null,
              user: { id: userId, username: "Usuário", discriminator: "0000", avatar: null },
            });
          }
          s.cache.relationships[accountId] = [...rels];
        });
        get().fetchRelationships(accountId);
      } catch (e) {
        console.error("Erro ao bloquear usuário:", e);
      }
    },

    unblockUser: async (accountId, userId) => {
      try {
        await api.removeRelationship(accountId, userId);
        set((s) => {
          if (s.cache.relationships[accountId]) {
            s.cache.relationships[accountId] = s.cache.relationships[accountId].filter((r) => r.user.id !== userId);
          }
        });
        get().fetchRelationships(accountId);
      } catch (e) {
        console.error("Erro ao desbloquear usuário:", e);
      }
    },

    sendMessage: async (accountId, channelId, content, replyTo) => {
      // Client-side rate limit guard — prevents spam before hitting Discord's API
      const rateError = checkMessageSendLimit(channelId);
      if (rateError) {
        const clydeMsg: DiscordMessage = {
          id: "clyde-rl-" + Date.now(),
          channel_id: channelId,
          author: {
            id: "1",
            username: "Clyde",
            global_name: "Clyde",
            discriminator: "0000",
            avatar: null,
            bot: true,
          },
          content: rateError,
          timestamp: new Date().toISOString(),
          edited_timestamp: null,
          attachments: [],
          embeds: [],
          pinned: false,
          type: 0,
        };
        get().prependMessage(accountId, channelId, clydeMsg);
        return;
      }

      try {
        const message = await api.sendMessage(accountId, channelId, content, replyTo);
        get().prependMessage(accountId, channelId, message);
      } catch (err: unknown) {
        console.error("Erro ao enviar mensagem:", err);
        const clydeMsg: DiscordMessage = {
          id: "clyde-" + Date.now(),
          channel_id: channelId,
          author: {
            id: "1",
            username: "Clyde",
            global_name: "Clyde",
            discriminator: "0000",
            avatar: null,
            bot: true,
          },
          content: "Sua mensagem não pôde ser entregue. Você não compartilha um servidor comum com este usuário ou o usuário te bloqueou.",
          timestamp: new Date().toISOString(),
          edited_timestamp: null,
          attachments: [],
          embeds: [],
          pinned: false,
          type: 0,
        };
        get().prependMessage(accountId, channelId, clydeMsg);
        throw err;
      }
    },

    editMessage: async (accountId, channelId, messageId, content) => {
      try {
        const msg = await api.editMessage(accountId, channelId, messageId, content);
        set((s) => {
          const channelMsgs = s.cache.messages[accountCacheKey(accountId, channelId)];
          if (channelMsgs) {
            const idx = channelMsgs.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              channelMsgs[idx] = msg;
            }
          }
        });
      } catch (e) {
        console.error("Erro ao editar msg", e);
        throw e;
      }
    },

    deleteMessage: async (accountId, channelId, messageId) => {
      // Client-side guard against bulk/rapid deletion
      const rateError = checkMessageDeleteLimit(channelId);
      if (rateError) {
        console.warn("[rate-limit] deleteMessage blocked:", rateError);
        throw new Error(rateError);
      }
      try {
        await api.deleteMessage(accountId, channelId, messageId);
        set((s) => {
          const channelMsgs = s.cache.messages[accountCacheKey(accountId, channelId)];
          if (channelMsgs) {
            s.cache.messages[accountCacheKey(accountId, channelId)] = channelMsgs.filter((m) => m.id !== messageId);
          }
        });
      } catch (e) {
        console.error("Erro ao deletar msg", e);
        throw e;
      }
    },

    sendMessageWithAttachment: async (accountId, channelId, content, replyTo, fileName, fileHandle, fileData) => {
      const message = await api.sendMessageWithAttachment(
        accountId,
        channelId,
        content,
        replyTo,
        fileName,
        fileHandle,
        fileData
      );
      get().prependMessage(accountId, channelId, message);
    },

    sendVoiceMessage: async (accountId, channelId, audioData, durationSecs, waveform, replyTo) => {
      const rateError = checkMessageSendLimit(channelId);
      if (rateError) {
        console.warn("[rate-limit] sendVoiceMessage blocked:", rateError);
        return;
      }
      const message = await api.sendVoiceMessage(
        accountId,
        channelId,
        audioData,
        durationSecs,
        waveform,
        replyTo
      );
      get().prependMessage(accountId, channelId, message);
    },

    addReaction: async (accountId, channelId, messageId, emoji) => {
      const mutationKey = reactionMessageKey(accountId, channelId, messageId);
      const reactionEmoji = normalizeReactionEmoji({ id: null, name: emoji });
      if (reactionEmoji.id) {
        const knownEmoji = Object.values(get().cache.guildEmojis[accountId] ?? {}).flat().find((item) => item.id === reactionEmoji.id);
        if (knownEmoji) reactionEmoji.animated = knownEmoji.animated;
      }
      // Client-side guard against reaction spam
      const rateError = checkReactionLimit(messageId);
      if (rateError) {
        console.warn("[rate-limit] addReaction blocked:", rateError);
        throw new Error(rateError);
      }
      beginReactionMutation(mutationKey);
      // Optimistic update
      set((s) => {
        const msgs = s.cache.messages[accountCacheKey(accountId, channelId)];
        if (msgs) {
          const msg = msgs.find(m => m.id === messageId);
          if (msg) {
            if (!msg.reactions) msg.reactions = [];
            const r = msg.reactions.find(x => sameReactionEmoji(x.emoji, reactionEmoji));
            if (r) {
              if (!r.me) {
                r.count++;
                r.me = true;
              }
            } else {
              msg.reactions.push({
                count: 1,
                me: true,
                emoji: reactionEmoji
              });
            }
          }
        }
      });
      try {
        await api.addReaction(accountId, channelId, messageId, emoji);
      } catch (e) {
        console.error(e);
        get().applyGatewayReaction(accountId, channelId, messageId, reactionEmoji, false, true);
        throw e;
      } finally {
        endReactionMutation(mutationKey);
      }
    },

    removeReaction: async (accountId, channelId, messageId, emoji) => {
      const mutationKey = reactionMessageKey(accountId, channelId, messageId);
      const reactionEmoji = normalizeReactionEmoji({ id: null, name: emoji });
      beginReactionMutation(mutationKey);
      // Optimistic update
      set((s) => {
        const msgs = s.cache.messages[accountCacheKey(accountId, channelId)];
        if (msgs) {
          const msg = msgs.find(m => m.id === messageId);
          if (msg && msg.reactions) {
            const rIndex = msg.reactions.findIndex(x => sameReactionEmoji(x.emoji, reactionEmoji));
            if (rIndex !== -1) {
              const r = msg.reactions[rIndex];
              if (r.me) {
                r.count--;
                r.me = false;
                if (r.count <= 0) {
                  msg.reactions.splice(rIndex, 1);
                }
              }
            }
          }
        }
      });
      try {
        await api.removeReaction(accountId, channelId, messageId, emoji);
      } catch (e) {
        console.error(e);
        get().applyGatewayReaction(accountId, channelId, messageId, reactionEmoji, true, true);
        throw e;
      } finally {
        endReactionMutation(mutationKey);
      }
    },

    prependMessage: (accountId, channelId, message) => {
      const key = accountCacheKey(accountId, channelId);
      // Unopened channels retain unread/notifications, not their entire history.
      if (!get().cache.messages[key] && get().activeMessageKey !== key) return;
      set((s) => {
        s.cache.messages[key] = mergeMessages(s.cache.messages[key] ?? [], [message]);
        s.messagePages[key] ??= { lastAccess: Date.now(), hasMore: true, historyExpanded: false };
        pruneDiscordMessageCache(s);
      });
    },

    addGuildEmojis: (accountId, guildId, emojis) => {
      set((s) => {
        if (!s.cache.guildEmojis[accountId]) {
          s.cache.guildEmojis[accountId] = {};
        }
        s.cache.guildEmojis[accountId][guildId] = emojis.map((e) => ({
          ...e,
          id: e.id || e.name || Math.random().toString(),
        })) as DiscordEmoji[];
        

      });
      scheduleEmojiPersistence(accountId, () => get().cache.guildEmojis[accountId]);
    },

    addGuildRoles: (accountId, guildId, roles) => {
      set((s) => {
        if (!s.cache.guildRoles) s.cache.guildRoles = {};
        if (!s.cache.guildRoles[accountId]) s.cache.guildRoles[accountId] = {};
        s.cache.guildRoles[accountId][guildId] = roles;
      });
    },

    updateMessageFromGateway: (accountId, channelId, message) => {
      set((s) => {
        const existing = s.cache.messages[accountCacheKey(accountId, channelId)]?.find((item) => item.id === message.id);
        if (existing) Object.assign(existing, message);
      });
    },

    removeMessageFromGateway: (accountId, channelId, messageId) => {
      set((s) => {
        const messages = s.cache.messages[accountCacheKey(accountId, channelId)];
        if (messages) {
          s.cache.messages[accountCacheKey(accountId, channelId)] = messages.filter((message) => message.id !== messageId);
        }
      });
    },

    applyGatewayReaction: (accountId, channelId, messageId, emoji, added, isCurrentUser) => {
      const reactionEmoji = normalizeReactionEmoji(emoji);
      markReactionChanged(reactionMessageKey(accountId, channelId, messageId));
      set((s) => {
        const message = s.cache.messages[accountCacheKey(accountId, channelId)]?.find((item) => item.id === messageId);
        if (!message) return;
        if (!message.reactions) message.reactions = [];

        const index = message.reactions.findIndex(
          (reaction) => sameReactionEmoji(reaction.emoji, reactionEmoji)
        );
        if (added) {
          if (index >= 0) {
            if (reactionEmoji.animated !== undefined) message.reactions[index].emoji.animated = reactionEmoji.animated;
            if (reactionEmoji.name) message.reactions[index].emoji.name = reactionEmoji.name;
            if (!isCurrentUser || !message.reactions[index].me) {
              message.reactions[index].count += 1;
            }
            if (isCurrentUser) message.reactions[index].me = true;
          } else {
            message.reactions.push({ count: 1, me: isCurrentUser, emoji: reactionEmoji });
          }
        } else if (index >= 0) {
          if (!isCurrentUser || message.reactions[index].me) {
            message.reactions[index].count = Math.max(0, message.reactions[index].count - 1);
          }
          if (isCurrentUser) message.reactions[index].me = false;
          if (message.reactions[index].count === 0) message.reactions.splice(index, 1);
        }
      });
    },

    addGuildMember: (accountId, guildId, member) => {
      set((s) => {
        if (!s.cache.guildMembers[accountId]) s.cache.guildMembers[accountId] = {};
        s.cache.guildMembers[accountId][guildId] = member;
      });
    },

    updatePresence: (accountId, presence) => {
      const norm = normalizePresence(presence);
      if (!norm) return;
      set((s) => {
        if (!s.cache.presences[accountId]) {
          s.cache.presences[accountId] = {};
        }
        const existing = s.cache.presences[accountId][norm.userId] || {};
        s.cache.presences[accountId][norm.userId] = {
          ...existing,
          ...norm.normalized,
          user: { ...(existing.user || {}), ...norm.normalized.user },
          client_status: { ...(existing.client_status || {}), ...norm.normalized.client_status },
        };
      });
    },

    updatePresences: (accountId, presences) => {
      if (!Array.isArray(presences)) return;
      set((s) => {
        if (!s.cache.presences[accountId]) {
          s.cache.presences[accountId] = {};
        }
        for (const presence of presences) {
          const norm = normalizePresence(presence);
          if (norm) {
            const existing = s.cache.presences[accountId][norm.userId] || {};
            s.cache.presences[accountId][norm.userId] = {
              ...existing,
              ...norm.normalized,
              user: { ...(existing.user || {}), ...norm.normalized.user },
              client_status: { ...(existing.client_status || {}), ...norm.normalized.client_status },
            };
          }
        }
      });
    },

    incrementUnread: (accountId, channelId, hasMention, guildId) => {
      set((s) => {
        if (!s.cache.unreads[accountId]) {
          s.cache.unreads[accountId] = {};
        }
        if (!s.cache.unreads[accountId][channelId]) {
          s.cache.unreads[accountId][channelId] = { count: 0, mentions: 0, guildId };
        }
        s.cache.unreads[accountId][channelId].count += 1;
        if (hasMention) {
          s.cache.unreads[accountId][channelId].mentions += 1;
        }
      });
    },

    clearUnread: async (accountId, channelId, messageId) => {
      set((s) => {
        if (s.cache.unreads[accountId] && s.cache.unreads[accountId][channelId]) {
          s.cache.unreads[accountId][channelId].count = 0;
          s.cache.unreads[accountId][channelId].mentions = 0;
        }
      });
      if (messageId) {
        try {
          await api.invoke("mark_channel_as_read", { accountId, channelId, messageId });
        } catch (e) {
          console.error("Failed to mark as read:", e);
        }
      }
    },

    addTypingUser: (accountId, channelId, userId, timestamp, member) => {
      if (!Number.isFinite(timestamp) || timestamp <= 0 || !channelId || !userId) return;
      set((s) => {
        const key = accountCacheKey(accountId, channelId);
        const now = Date.now();
        for (const typingKey of Object.keys(s.cache.typingUsers)) {
          const activeUsers = s.cache.typingUsers[typingKey].filter((user) => now - user.timestamp < 10_000);
          if (activeUsers.length) s.cache.typingUsers[typingKey] = activeUsers;
          else delete s.cache.typingUsers[typingKey];
        }
        if (!s.cache.typingUsers[key]) s.cache.typingUsers[key] = [];

        const existing = s.cache.typingUsers[key].find((user) => user.userId === userId);
        if (existing) {
          existing.timestamp = timestamp;
          if (member) existing.member = member;
        } else {
          s.cache.typingUsers[key].push({ userId, timestamp, member });
        }

        // Typing events are transient; bound each channel even for large group DMs.
        if (s.cache.typingUsers[key].length > 50) s.cache.typingUsers[key].splice(0, s.cache.typingUsers[key].length - 50);
      });
    },

    clearCache: (accountId) => {
      accountEpochs.set(accountId, epochFor(accountId) + 1);
      for (const key of messageRequests.keys()) if (key.startsWith(`${accountId}:`)) messageRequests.delete(key);
      clearEmojiPersistence(accountId);
      set((s) => {
        for (const collection of [s.cache.guilds, s.cache.channels, s.cache.dms, s.cache.guildEmojis,
          s.cache.guildRoles, s.cache.guildMembers, s.cache.relationships, s.cache.presences,
          s.cache.session_ids, s.cache.unreads, s.channelLoads, s.loading.guilds]) delete collection[accountId];
        for (const collection of [s.cache.messages, s.cache.threads, s.cache.pinnedMessages,
          s.cache.typingUsers, s.messagePages, s.loading.messages, s.loading.threads]) {
          for (const key of Object.keys(collection)) if (key.startsWith(`${accountId}:`)) delete collection[key];
        }
        if (s.activeMessageKey?.startsWith(`${accountId}:`)) s.activeMessageKey = null;
        for (const key of Object.keys(s.errors)) if (key.includes(accountId)) delete s.errors[key];
      });
    },
  }))
);

import { useEffect } from "react";
import { useAccountStore } from "@/stores/accountStore";
import { useDiscordStore, pruneDiscordMessageCache } from "@/stores/discordStore";
import { accountCacheKey, EMPTY_MESSAGES } from "@/lib/messageCache";

export function useChannelMessages(accountId: string, channelId: string) {
  const key = accountCacheKey(accountId, channelId);
  const messages = useDiscordStore((s) => s.cache.messages[key] ?? EMPTY_MESSAGES);
  const isLoading = useDiscordStore((s) => s.loading.messages[key] ?? false);
  const connected = useAccountStore((s) => s.sessions[accountId]?.status === "Connected");

  useEffect(() => {
    const store = useDiscordStore.getState();
    store.activateMessageChannel(accountId, channelId);
    void store.recoverMessages(accountId, channelId);
    return () => {
      useDiscordStore.setState((s) => {
        if (s.activeMessageKey !== key) return;
        s.activeMessageKey = null;
        delete s.cache.typingUsers[key];
        pruneDiscordMessageCache(s);
      });
    };
  }, [accountId, channelId, key]);

  useEffect(() => {
    if (connected) void useDiscordStore.getState().recoverMessages(accountId, channelId);
  }, [connected, accountId, channelId]);

  useEffect(() => {
    const recover = () => {
      if (document.visibilityState === "visible") void useDiscordStore.getState().recoverMessages(accountId, channelId);
    };
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [accountId, channelId]);

  return { messages, isLoading };
}

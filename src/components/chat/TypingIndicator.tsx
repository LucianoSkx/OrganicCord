import React, { useEffect, useState } from "react";
import { useDiscordStore } from "@/stores/discordStore";
import { useAccountStore } from "@/stores/accountStore";
import { accountCacheKey } from "@/lib/messageCache";
import { formatTypingNames, resolveTypingName } from "@/lib/typing";

interface Props {
  accountId: string;
  channelId: string;
}

export function TypingIndicator({ accountId, channelId }: Props) {
  const key = accountCacheKey(accountId, channelId);
  const typingUsersRaw = useDiscordStore((store) => store.cache.typingUsers[key]);
  const dms = useDiscordStore((store) => store.cache.dms[accountId] ?? []);
  const relationships = useDiscordStore((store) => store.cache.relationships[accountId] ?? []);
  const currentUserId = useAccountStore((store) => store.accounts.find((account) => account.id === accountId)?.user_id);
  const [expiryTick, setExpiryTick] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const nextExpiry = (typingUsersRaw ?? [])
      .map((user) => user.timestamp + 10_000)
      .filter((timestamp) => timestamp > now)
      .sort((a, b) => a - b)[0];
    if (nextExpiry === undefined) return;

    const timer = window.setTimeout(() => setExpiryTick((tick) => tick + 1), nextExpiry - now + 1);
    return () => window.clearTimeout(timer);
  }, [typingUsersRaw, expiryTick]);

  const now = Date.now();
  const names = (typingUsersRaw ?? [])
    .filter((user) => user.userId !== currentUserId && now - user.timestamp < 10_000)
    .map((user) => resolveTypingName(user.userId, user.member, dms, relationships));
  const text = formatTypingNames(names);
  if (!text) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", height: 24, zIndex: 10 }}>
      <div style={{ display: "flex", gap: 3, alignItems: "center", height: 24, paddingLeft: 4 }} aria-hidden="true">
        <div className="typing-dot" style={{ animationDelay: "0s" }} />
        <div className="typing-dot" style={{ animationDelay: "0.2s" }} />
        <div className="typing-dot" style={{ animationDelay: "0.4s" }} />
      </div>
      <span role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
        {text}
      </span>

      <style>{`
        @keyframes typingBounce {
          0%, 100% { transform: scale(0.8); opacity: 0.5; }
          50% { transform: scale(1.2); opacity: 1; }
        }
        .typing-dot {
          width: 5px;
          height: 5px;
          background-color: var(--text-muted);
          border-radius: 50%;
          animation: typingBounce 1.4s infinite ease-in-out both;
        }
      `}</style>
    </div>
  );
}

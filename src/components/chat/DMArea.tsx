import { useShallow } from "zustand/react/shallow";
import { useChannelMessages } from "@/hooks/useChannelMessages";
import { useEffect, useState, useCallback, useRef } from "react";
import { useDiscordStore } from "@/stores/discordStore";
import { useAccountStore } from "@/stores/accountStore";
import { MessageList } from "./MessageList";
import { MessageInput, AttachmentData } from "./MessageInput";
import { Avatar } from "@/components/ui/Avatar";
import type { DiscordMessage } from "@/types";
import { ActiveCallArea } from "./ActiveCallArea";
import { Phone, Video, Search } from "lucide-react";
import { useVoiceStore } from "@/stores/voiceStore";
import { PinnedMessagesPopover } from "./PinnedMessagesPopover";
import { SearchResultsSidebar } from "./SearchResultsSidebar";
import { TypingIndicator } from "./TypingIndicator";
import { ChatDropOverlay } from "./ChatDropOverlay";
import { toast } from "@/components/ui/Toast";

interface Props {
  channelId: string;
  accountId: string;
}

export function DMArea({ channelId, accountId }: Props) {
  const { fetchMoreMessages, sendMessage, deleteMessage, fetchDMs } = useDiscordStore(useShallow((s) => ({ fetchMoreMessages: s.fetchMoreMessages, sendMessage: s.sendMessage, deleteMessage: s.deleteMessage, fetchDMs: s.fetchDMs })));
  const { messages, isLoading } = useChannelMessages(accountId, channelId);
  const { accounts } = useAccountStore(useShallow((s) => ({ accounts: s.accounts })));
  const { joinCall, leaveCall, isConnecting, isConnected, channelId: voiceChannelId } = useVoiceStore(useShallow((s) => ({ joinCall: s.joinCall, leaveCall: s.leaveCall, isConnecting: s.isConnecting, isConnected: s.isConnected, channelId: s.channelId })));
  const [replyingTo, setReplyingTo] = useState<DiscordMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<AttachmentData | null>(null);
  const dragCounterRef = useRef(0);

  const account = accounts.find((a) => a.id === accountId);

  const dms = useDiscordStore((s) => s.cache.dms[accountId]) ?? [];
  const dm = dms.find((d) => d.id === channelId);
  const recipient = dm?.recipients?.[0];
  const targetName = recipient?.global_name || recipient?.username || "DM";


  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.size > 25 * 1024 * 1024) {
        toast.error("Arquivo maior que 25MB. Por favor use arquivos menores.");
        return;
      }
      setPendingAttachment({ type: "file", file });
      toast.success(`Arquivo "${file.name}" pronto para envio!`);
    }
  };

  useEffect(() => {
    if (!useDiscordStore.getState().cache.dms[accountId]) void fetchDMs(accountId);
    void useDiscordStore.getState().clearUnread(accountId, channelId);
    setSearchQuery(null);
    setPendingAttachment(null);
  }, [channelId, accountId, fetchDMs]);

  const handleSend = useCallback(async (content: string, attachment?: AttachmentData) => {
    if (!accountId || !channelId) return;
    const finalAttachment = attachment ?? pendingAttachment;
    try {
      if (finalAttachment) {
        if (finalAttachment.type === "file") {
          const buffer = await finalAttachment.file.arrayBuffer();
          const data = new Uint8Array(buffer);
          await useDiscordStore.getState().sendMessageWithAttachment(
            accountId,
            channelId,
            content,
            replyingTo?.id,
            finalAttachment.file.name,
            undefined,
            data
          );
        } else if (finalAttachment.type === "handle") {
          await useDiscordStore.getState().sendMessageWithAttachment(
            accountId,
            channelId,
            content,
            replyingTo?.id,
            finalAttachment.name,
            finalAttachment.handle,
            undefined
          );
        }
      } else {
        await sendMessage(accountId, channelId, content, replyingTo?.id);
      }
      setReplyingTo(null);
      setPendingAttachment(null);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  }, [accountId, channelId, replyingTo, sendMessage, pendingAttachment]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-primary)", position: "relative" }}
    >
      <ChatDropOverlay
        isDragging={isDragging}
        canUpload={true}
        targetName={targetName}
      />
      {/* Header */}
      <div
        style={{
          height: 48,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {recipient && (
          <>
            <Avatar userId={recipient.id} avatarHash={recipient.avatar} avatarDecoration={recipient.avatar_decoration_data} username={recipient.username} size={32} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>
              {recipient.global_name ?? recipient.username}
            </span>
            {recipient.bot && (
              <span style={{ fontSize: 10, fontWeight: 700, background: "var(--brand-500)", color: "#fff", padding: "1px 5px", borderRadius: "var(--radius-xs)" }}>
                BOT
              </span>
            )}
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Ícones da Direita (estilo Discord) */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, color: "var(--interactive-normal)" }}>
          <button
            onClick={() => {
              if (isConnected || isConnecting) {
                leaveCall();
              } else {
                joinCall(accountId, null, channelId);
              }
            }}
            disabled={isConnecting}
            title={isConnected ? "Desligar chamada" : "Iniciar chamada de voz"}
            className="header-icon-button"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isConnected ? "var(--status-online)" : "inherit",
              opacity: isConnecting ? 0.5 : 1,
              padding: 0,
              transition: "color 0.2s",
            }}
          >
            <Phone size={24} strokeWidth={2} fill={isConnected ? "currentColor" : "none"} />
          </button>

          <button
            title="Iniciar chamada de vídeo"
            className="header-icon-button"
            style={{
              background: "transparent",
              border: "none",
              cursor: "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "inherit",
              padding: 0,
              opacity: 0.5,
            }}
          >
            <Video size={24} strokeWidth={2} />
          </button>

          <PinnedMessagesPopover channels={[]} />

          {/* Search input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--bg-tertiary)",
              borderRadius: "var(--radius-sm)",
              padding: "4px 8px",
              width: 160,
              gap: 6,
            }}
          >
            <input
              placeholder="Buscar..."
              onKeyDown={(e) => {
                 if (e.key === "Enter" && e.currentTarget.value) {
                   setSearchQuery(e.currentTarget.value);
                 }
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-normal)",
                outline: "none",
                width: "100%",
                fontSize: 13,
              }}
            />
            <Search size={14} color="var(--text-muted)" />
          </div>

        </div>
      </div>

      {/* Messages / Call Area */}
      {(isConnected || isConnecting) && channelId === voiceChannelId && recipient && (
        <ActiveCallArea recipient={recipient} />
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <MessageList
              key={`${accountId}:${channelId}`}
              messages={messages}
              isLoading={isLoading}
              currentUserId={account?.user_id ?? ""}
              onLoadMore={() => fetchMoreMessages(accountId, channelId)}
              onReply={setReplyingTo}
              onDelete={(messageId) => deleteMessage(accountId, channelId, messageId)}
            />
          </div>

          <TypingIndicator accountId={accountId} channelId={channelId} />

          <MessageInput
          key={`${accountId}:${channelId}`}
            channelId={channelId}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            onSend={handleSend}
            accountColor={account?.color}
            externalAttachment={pendingAttachment}
          />
        </div>

        {searchQuery !== null && (
          <SearchResultsSidebar
            accountId={accountId}
            channelId={channelId}
            query={searchQuery}
            onClose={() => setSearchQuery(null)}
            onSearch={setSearchQuery}
          />
        )}
      </div>

    </div>
  );
}

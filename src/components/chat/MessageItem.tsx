import { useMessageAudioStore } from "@/stores/messageAudioStore";
import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { lazy, Suspense, useState } from "react";
import type { DiscordMessage, DiscordChannel } from "@/types";
import { Avatar } from "@/components/ui/Avatar";
import { formatTimestamp, getDisplayName } from "@/lib/utils";
import { useNavigationStore } from "@/stores/navigationStore";
import { useDiscordStore } from "@/stores/discordStore";
import { MessageContent } from "./MessageContent";
import { MediaPreview } from "./MediaPreview";
import { EmbedRenderer } from "./EmbedRenderer";
import { PollRenderer } from "./PollRenderer";
import { MessageComponentsRenderer } from "./MessageComponentsRenderer";
import { MessageContextMenu } from "@/components/ui/MessageContextMenu";
import { Reply, Paperclip, SmilePlus, Phone, Pin, BarChart3, Check, Play, Pause } from "lucide-react";
import type { EmojiClickData } from "emoji-picker-react";
import * as Popover from "@radix-ui/react-popover";
import { useMemo } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { OrganicMark } from "@/components/ui/OrganicMark";
import { UserProfilePopover } from "@/components/profile/UserProfilePopover";
import { DiscordEmojiPicker } from "./DiscordEmojiPicker";
import { toast } from "@/components/ui/Toast";
import { useSettingsStore } from "@/stores/settingsStore";
import { emojiCatalog, normalizeReactionEmoji, reactionIdentifier, parseCustomEmojiToken } from "@/lib/emoji";

const EmojiPickerPanel = lazy(() =>
  import("./EmojiPickerPanel").then((module) => ({ default: module.EmojiPickerPanel })),
);

interface Props {
  message: DiscordMessage;
  isGrouped?: boolean;
  isOwn?: boolean;
  onReply: () => void;
  onDelete?: () => void;
  channels?: DiscordChannel[];
}

export const MessageItem = memo(function MessageItem({ message, isGrouped, isOwn, onReply, onDelete, channels = [] }: Props) {
  const { displayMode, fontSize, messageSpacing } = useSettingsStore((s) => s.settings);
  const compact = displayMode === "compact";
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content || "");
  const { activeAccountId, activeChannelId } = useNavigationStore(useShallow((s) => ({ activeAccountId: s.activeAccountId, activeChannelId: s.activeChannelId })));
  const { addReaction, removeReaction, pinMessage, unpinMessage, editMessage } = useDiscordStore(useShallow((s) => ({ addReaction: s.addReaction, removeReaction: s.removeReaction, pinMessage: s.pinMessage, unpinMessage: s.unpinMessage, editMessage: s.editMessage })));
  
  const guildEmojisRaw = useDiscordStore((s) => activeAccountId ? s.cache.guildEmojis[activeAccountId] : null);

  const customEmojis = emojiCatalog(guildEmojisRaw);

  const author = message.author;
  const displayName = getDisplayName(author);

  const handleEmojiReact = async (emojiData: EmojiClickData) => {
    let emojiStr = emojiData.emoji;
    if (emojiData.isCustom) {
      const emojiName = emojiData.names?.[0] || "emoji";
      emojiStr = `${emojiName}:${emojiData.unified}`;
    }
    if (activeAccountId && activeChannelId) {
      try {
        await addReaction(activeAccountId, activeChannelId, message.id, emojiStr);
      } catch (error) {
        toast.error(`Não foi possível adicionar a reação: ${String(error).replace(/^Error:\s*/, "")}`);
      }
    }
    setReactionPickerOpen(false);
  };

  const handleToggleReaction = async (emoji: string, me: boolean) => {
    if (activeAccountId && activeChannelId) {
      if (me) {
        try {
          await removeReaction(activeAccountId, activeChannelId, message.id, emoji);
        } catch (error) {
          toast.error(`Não foi possível remover a reação: ${String(error).replace(/^Error:\s*/, "")}`);
        }
      } else {
        try {
          await addReaction(activeAccountId, activeChannelId, message.id, emoji);
        } catch (error) {
          toast.error(`Não foi possível adicionar a reação: ${String(error).replace(/^Error:\s*/, "")}`);
        }
      }
    }
  };

  const handlePin = () => {
    if (activeAccountId && activeChannelId) {
      pinMessage(activeAccountId, activeChannelId, message.id);
    }
  };

  const handleUnpin = () => {
    if (activeAccountId && activeChannelId) {
      unpinMessage(activeAccountId, activeChannelId, message.id);
    }
  };

  const isSystemMessage = message.type !== 0 && message.type !== 19 && message.type !== undefined;

  return (
    <div
      className={compact ? "message-row message-row-compact" : "message-row"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        display: "flex",
        padding: compact ? `${isGrouped ? 1 : 3}px 16px` : isGrouped && !isSystemMessage ? "1px 16px 1px 72px" : `${Math.round(messageSpacing / 2)}px 16px`,
        gap: compact ? 6 : 16,
        position: "relative",
        background: hovered ? "var(--bg-message-hover)" : "transparent",
        transition: "background 80ms",
      }}
    >
      {/* Avatar ou timestamp (para mensagens agrupadas) */}
      {compact && !isSystemMessage ? null : isGrouped && !isSystemMessage ? (
        hovered && (
          <div
            className="selectable"
            style={{
              position: "absolute",
              left: 16,
              top: "50%",
              transform: "translateY(-50%)",
              width: 40,
              textAlign: "center",
              fontSize: 11,
              color: "var(--text-muted)",
              userSelect: "none",
            }}
          >
            {formatTimestamp(message.timestamp)}
          </div>
        )
      ) : isSystemMessage ? (
        <div style={{ flexShrink: 0, marginTop: 2, width: 40, display: "flex", justifyContent: "center" }}>
          {message.type === 6 ? (
            <Pin size={20} style={{ color: "var(--text-positive)" }} />
          ) : message.type === 24 ? (
            <BarChart3 size={20} style={{ color: "var(--text-muted)" }} />
          ) : message.type === 3 ? (
            <Phone size={20} style={{ color: "var(--text-positive)" }} />
          ) : (
            <div style={{ width: 20, height: 20, background: "var(--text-muted)", borderRadius: "50%" }} />
          )}
        </div>
      ) : (
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <UserProfilePopover userId={author.id}>
            <button style={{ background: "transparent", border: "none", padding: 0, outline: "none", cursor: "pointer" }}>
              <div>
                <Avatar
                  userId={author.id}
                  avatarHash={author.avatar}
                  avatarDecoration={author.avatar_decoration_data}
                  username={author.username}
                  size={40}
                />
              </div>
            </button>
          </UserProfilePopover>
        </div>
      )}

      {/* Conteúdo da mensagem */}
      <div style={{ flex: 1, minWidth: 0, display: compact ? "block" : "flex", flexDirection: compact ? undefined : "column", justifyContent: "center" }}>
        {(!isGrouped || compact) && !isSystemMessage && (
          <div
            className={compact ? "message-compact-heading" : undefined}
            style={{
              display: compact ? "inline-flex" : "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: compact ? 0 : 2,
              marginRight: compact ? 10 : 0,
            }}
          >
            <UserProfilePopover userId={author.id}>
              <button style={{ background: "transparent", border: "none", padding: 0, outline: "none" }}>
                <span
                  className="hover-underline"
                  style={{
                    fontWeight: 500,
                    color: isOwn ? "var(--brand-500)" : "var(--text-normal)",
                    fontSize: compact ? Math.max(12, fontSize - 1) : 15,
                    cursor: "pointer",
                    transition: "text-decoration 120ms",
                  }}
                >
                  {displayName}
                </span>
              </button>
            </UserProfilePopover>
            {author.bot && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  background: "var(--brand-500)",
                  color: "#fff",
                  padding: "1px 5px",
                  borderRadius: "var(--radius-xs)",
                  textTransform: "uppercase",
                }}
              >
                BOT
              </span>
            )}
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {formatTimestamp(message.timestamp)}
            </span>
          </div>
        )}

        {/* Mensagem referenciada (reply) */}
        {message.referenced_message && (
          <ReplyPreview message={message.referenced_message} channels={channels} />
        )}

        {/* Conteúdo de texto */}
        <div
          className={compact ? "selectable message-compact-content" : "selectable"}
          style={{
            fontSize,
            color: message.content ? "var(--text-normal)" : "var(--text-muted)",
            lineHeight: 1.375,
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {isEditing ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)", padding: 8 }}>
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (activeAccountId && activeChannelId && editValue.trim()) {
                        editMessage(activeAccountId, activeChannelId, message.id, editValue);
                        setIsEditing(false);
                      }
                    } else if (e.key === "Escape") {
                      setIsEditing(false);
                      setEditValue(message.content || "");
                    }
                  }}
                  autoFocus
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--text-normal)",
                    fontFamily: "inherit",
                    fontSize: 15,
                    resize: "none",
                    minHeight: 40,
                  }}
                />
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <span style={{ color: "var(--text-muted)" }}>esc para </span>
                <span style={{ color: "var(--text-link)", cursor: "pointer", fontWeight: 500 }} onClick={() => { setIsEditing(false); setEditValue(message.content || ""); }}>cancelar</span>
                <span style={{ color: "var(--text-muted)" }}> • enter para </span>
                <span style={{ color: "var(--text-link)", cursor: "pointer", fontWeight: 500 }} onClick={() => {
                  if (activeAccountId && activeChannelId && editValue.trim()) {
                    editMessage(activeAccountId, activeChannelId, message.id, editValue);
                    setIsEditing(false);
                  }
                }}>salvar</span>
              </div>
            </div>
          ) : message.content ? (
            <MessageContent content={message.content} channels={channels} />
          ) : message.type === 3 ? (
            <span style={{ fontSize: 15, fontWeight: 500 }}>
              {isOwn ? "Você iniciou uma chamada." : `Você perdeu uma chamada de `}
              <span style={{ fontWeight: 600, color: "var(--text-normal)" }}>{displayName}</span>.
            </span>
          ) : message.type === 6 ? (
            <span style={{ fontSize: 15, color: "var(--text-muted)", display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontWeight: 600, color: "var(--text-normal)" }}>{displayName}</span>
              fixou uma mensagem neste canal.
            </span>
          ) : message.type === 24 ? (
            (() => {
              const pollEmbed = message.embeds?.find(e => e.fields?.some(f => f.name === "pollquestiontext"));
              const getField = (name: string) => pollEmbed?.fields?.find(f => f.name === name)?.value;
              const question = getField("pollquestiontext");
              const answerText = getField("victoranswertext");
              const votes = parseInt(getField("victoranswervotes") || "0", 10);
              const totalVotes = parseInt(getField("total_votes") || "0", 10);
              const percentage = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.4 }}>
                    A pesquisa <strong style={{ color: "var(--text-normal)" }}>{question}</strong> de <strong style={{ color: "var(--text-normal)" }}>{displayName}</strong> foi encerrada.
                  </span>
                  
                  {answerText && (
                    <div style={{
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-md)",
                      padding: "12px 16px",
                      maxWidth: "400px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--text-normal)" }}>
                          {answerText}
                          <div style={{ background: "var(--text-positive)", color: "white", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16 }}>
                            <Check size={10} strokeWidth={3} />
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>
                          Resposta vitoriosa • {percentage}%
                        </div>
                      </div>
                      <button style={{
                        background: "var(--bg-modifier-hover)",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        padding: "6px 12px",
                        color: "var(--text-normal)",
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: "pointer"
                      }}>
                        Ver Enquete
                      </button>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (message.embeds && message.embeds.length > 0) || message.poll || (message.components && message.components.length > 0) || (message.attachments && message.attachments.length > 0) ? null : (
            <em style={{ fontSize: 14, color: "var(--text-muted)" }}>
              [mensagem vazia]
            </em>
          )}
        </div>

        {/* Poll */}
        {message.poll && <PollRenderer poll={message.poll} />}

        {/* Anexos */}
        {message.attachments.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <AttachmentList attachments={message.attachments} flags={message.flags} />
            {(!message.content || message.content.trim().length === 0) && (
              <em style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.7 }}>
                [{message.attachments.length} anexo(s)]
              </em>
            )}
          </div>
        )}

        {/* Embeds de bot */}
        {message.embeds && message.embeds.length > 0 && (
          <EmbedRenderer 
            embeds={message.embeds.filter(e => !message.poll || !e.fields?.some(f => f.name === "pollquestiontext"))} 
          />
        )}

        {/* Componentes (Botões, Select Menus, etc) */}
        {message.components && message.components.length > 0 && (
          <MessageComponentsRenderer components={message.components} message={message} />
        )}

        {/* Reações */}
        {message.reactions && message.reactions.length > 0 && (
          <ReactionList reactions={message.reactions} onToggle={handleToggleReaction} />
        )}
      </div>

      {/* Action bar ao hover */}
      {(hovered || reactionPickerOpen) && (
        <div
          style={{
            position: "absolute",
            top: -16,
            right: 16,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            gap: 2,
            padding: "2px 4px",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <ActionButton onClick={onReply} label="Responder">
                <Reply size={16} />
              </ActionButton>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="top" sideOffset={5} style={{ background: "var(--bg-floating)", padding: "4px 8px", borderRadius: 4, fontSize: 12, fontWeight: 500, color: "var(--text-normal)", boxShadow: "0 4px 6px rgba(0,0,0,0.2)" }}>
                Responder
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            {activeAccountId ? (
              <DiscordEmojiPicker 
                accountId={activeAccountId}
                onSelect={(emojiStr) => {
                  const selected = parseCustomEmojiToken(emojiStr);
                  if (selected) {
                    if (activeAccountId && activeChannelId) {
                      addReaction(activeAccountId, activeChannelId, message.id, `${selected.name}:${selected.id}`).catch((error) => {
                        toast.error(`Não foi possível adicionar a reação: ${String(error).replace(/^Error:\s*/, "")}`);
                      });
                    }
                  }
                }}
              >
                <Tooltip.Trigger asChild>
                  <ActionButton onClick={() => {}} label="Emojis de Servidor">
                    <OrganicMark size={16} />
                  </ActionButton>
                </Tooltip.Trigger>
              </DiscordEmojiPicker>
            ) : (
              <div />
            )}
            <Tooltip.Portal>
              <Tooltip.Content side="top" sideOffset={5} style={{ background: "var(--bg-floating)", padding: "4px 8px", borderRadius: 4, fontSize: 12, fontWeight: 500, color: "var(--text-normal)", boxShadow: "0 4px 6px rgba(0,0,0,0.2)" }}>
                Emojis de Servidor
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Popover.Root open={reactionPickerOpen} onOpenChange={setReactionPickerOpen}>
            <Popover.Trigger asChild>
              <div>
                <ActionButton onClick={() => {}} label="Adicionar Reação">
                  <SmilePlus size={16} />
                </ActionButton>
              </div>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="top" align="end" sideOffset={10} style={{ zIndex: 100 }}>
                <Suspense fallback={<div style={{ width: 350, height: 450 }} />}>
                  <EmojiPickerPanel
                    onEmojiClick={handleEmojiReact}
                    lazyLoadEmojis={true}
                    searchPlaceHolder="Pesquisar emoji..."
                    customEmojis={customEmojis}
                    customCategoryIcon={<OrganicMark size={16} />}
                  />
                </Suspense>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <ActionButton onClick={onReply} label="Responder">
            <Reply size={16} />
          </ActionButton>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          messageId={message.id}
          content={message.content || ""}
          isOwn={!!isOwn}
          onReply={onReply}
          onEdit={() => {
            setIsEditing(true);
            setEditValue(message.content || "");
          }}
          onDelete={onDelete}
          isPinned={message.pinned}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});

function ReplyPreview({ message, channels }: { message: DiscordMessage; channels: DiscordChannel[] }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 4,
        paddingLeft: 8,
        borderLeft: "2px solid var(--interactive-muted)",
        color: "var(--text-muted)",
        fontSize: 13,
      }}
    >
      <Avatar
        userId={message.author.id}
        avatarHash={message.author.avatar}
        avatarDecoration={message.author.avatar_decoration_data}
        username={message.author.username}
        size={16}
      />
      <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>
        {getDisplayName(message.author)}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 300,
        }}
      >
        {message.content ? (
          <MessageContent content={message.content} channels={channels} />
        ) : "[anexo]"}
      </span>
    </div>
  );
}

function decodeWaveform(waveformBase64?: string): number[] {
  if (!waveformBase64) {
    return [
      15, 30, 50, 85, 115, 70, 45, 95, 140, 185, 125, 80, 50, 95, 165, 225,
      195, 135, 90, 55, 110, 155, 95, 65, 120, 175, 135, 75, 45, 30, 20, 15
    ];
  }
  try {
    const raw = atob(waveformBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    const barCount = 32;
    const step = bytes.length / barCount;
    const result: number[] = [];
    for (let i = 0; i < barCount; i++) {
      const startIdx = Math.floor(i * step);
      const endIdx = Math.floor((i + 1) * step);
      let maxVal = 0;
      for (let j = startIdx; j < endIdx && j < bytes.length; j++) {
        if (bytes[j] > maxVal) maxVal = bytes[j];
      }
      result.push(maxVal || 20);
    }
    return result;
  } catch (e) {
    return [
      20, 40, 60, 80, 100, 120, 140, 160, 140, 120, 100, 80, 60, 40, 20, 40,
      60, 80, 100, 120, 140, 160, 140, 120, 100, 80, 60, 40, 20, 30, 20, 10
    ];
  }
}

function formatVoiceTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function VoiceMessagePlayer({ attachment }: { attachment: import("@/types").Attachment }) {
  const accountId = useNavigationStore((s) => s.activeAccountId);
  const { playing: isPlaying, currentTime, duration, playbackRate } = useMessageAudioStore(useShallow((s) => ({
    playing: s.id === attachment.id && s.accountId === accountId && s.playing,
    currentTime: s.id === attachment.id && s.accountId === accountId ? s.currentTime : 0,
    duration: s.id === attachment.id && s.accountId === accountId ? s.duration : attachment.duration_secs ?? 0,
    playbackRate: s.playbackRate,
  })));
  const samples = useMemo(() => decodeWaveform(attachment.waveform), [attachment.waveform]);
  const togglePlay = () => { void useMessageAudioStore.getState().toggle(attachment, accountId).catch(console.error); };
  const handleSeek = (index: number) => {
    if (samples.length) useMessageAudioStore.getState().seek(attachment, accountId, index / samples.length * (duration || 1));
  };
  const cycleSpeed = () => useMessageAudioStore.getState().setRate(playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1);

  const currentRatio = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "10px 14px",
        width: 320,
        maxWidth: "100%",
        margin: "6px 0",
        userSelect: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      }}
    >
      {/* Play/Pause Button */}
      <button
        aria-label={isPlaying ? "Pausar mensagem de voz" : "Reproduzir mensagem de voz"}
        onClick={togglePlay}
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "var(--brand-500)",
          border: "none",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          transition: "transform 100ms ease",
        }}
        className="hover-opacity"
      >
        {isPlaying ? <Pause size={18} fill="#fff" /> : <Play size={18} fill="#fff" style={{ marginLeft: 2 }} />}
      </button>

      {/* Waveform Visualization Bars */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          flex: 1,
          height: 32,
          cursor: "pointer",
        }}
      >
        {samples.map((sample, idx) => {
          const heightPercent = Math.max(15, Math.min(100, (sample / 255) * 100));
          const isPlayed = idx / samples.length <= currentRatio;
          return (
            <div
              key={idx}
              onClick={() => handleSeek(idx)}
              style={{
                flex: 1,
                height: `${heightPercent}%`,
                background: isPlayed ? "var(--brand-500)" : "var(--interactive-muted)",
                borderRadius: 2,
                transition: "background 100ms, height 100ms",
              }}
            />
          );
        })}
      </div>

      {/* Time & Speed controls */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", fontFamily: "monospace" }}>
          {formatVoiceTime(isPlaying ? currentTime : duration)}
        </span>
        <button
          onClick={cycleSpeed}
          style={{
            background: "var(--bg-tertiary)",
            border: "none",
            borderRadius: 10,
            padding: "1px 6px",
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
          title="Velocidade de reprodução"
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
}

function AttachmentList({
  attachments,
  flags,
}: {
  attachments: import("@/types").Attachment[];
  flags?: number;
}) {
  const { setFocusedImage } = useNavigationStore(useShallow((s) => ({ setFocusedImage: s.setFocusedImage })));

  return (
    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
      {attachments.map((att) => {
        const isVoiceMsg =
          !!att.waveform ||
          !!att.duration_secs ||
          (flags && (flags & 8192) !== 0) ||
          att.filename.includes("voice-message") ||
          att.content_type?.startsWith("audio/");

        if (isVoiceMsg) {
          return <VoiceMessagePlayer key={att.id} attachment={att} />;
        }

        const isImage = att.content_type?.startsWith("image/");
        return isImage ? (
          <MediaPreview
            key={att.id}
            src={att.url}
            proxyUrl={att.proxy_url}
            previewWidth={400} previewHeight={300}
            alt={att.filename}
            style={{
              aspectRatio: att.width && att.height ? `${att.width} / ${att.height}` : undefined,
              width: att.width && att.height ? Math.min(400, att.width, 300 * att.width / att.height) : undefined,
              height: "auto",
              maxWidth: "min(400px, 100%)",
              maxHeight: 300,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
              cursor: "pointer",
            }}
            onClick={() => setFocusedImage(att.url)}
          />
        ) : (
          <a
            key={att.id}
            href={att.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 12px",
              color: "var(--text-link)",
              fontSize: 14,
            }}
          >
            <Paperclip size={14} style={{ flexShrink: 0 }} /> {att.filename}
          </a>
        );
      })}
    </div>
  );
}

function ReactionList({
  reactions,
  onToggle,
}: {
  reactions: import("@/types").Reaction[];
  onToggle: (emojiName: string, me: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {reactions.map((r, i) => {
        const emoji = normalizeReactionEmoji(r.emoji);
        const emojiName = emoji.name ?? "emoji";
        const emojiIdentifier = reactionIdentifier(emoji);
        return (
        <button type="button"
          key={i}
          onClick={() => onToggle(emojiIdentifier, !!r.me)}
          aria-label={`${emojiName}: ${r.count} reações${r.me ? ", sua reação" : ""}`}
          style={{
            background: r.me ? "rgba(88,101,242,0.15)" : "var(--bg-secondary)",
            border: `1px solid ${r.me ? "rgba(88,101,242,0.4)" : "var(--border-subtle)"}`,
            borderRadius: "var(--radius-full)",
            padding: "2px 8px",
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {emoji.id ? (
            <img loading="lazy" decoding="async"
              src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "webp"}?size=20`}
              alt={emojiName}
              style={{ width: 18, height: 18, verticalAlign: "middle" }}
            />
          ) : (
            <span>{emojiName}</span>
          )}
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
            {r.count}
          </span>
        </button>
      );})}
    </div>
  );
}

import { forwardRef } from "react";

const ActionButton = forwardRef<HTMLButtonElement, {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}>(({ onClick, label, children }, ref) => {
  return (
    <button
      ref={ref}
      onClick={onClick}
      title={label}
      className="hover-bg-accent hover-color-normal"
      style={{
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-xs)",
        width: 28,
        height: 28,
        cursor: "pointer",
        color: "var(--interactive-normal)",
        fontSize: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 80ms, color 80ms",
      }}
    >
      {children}
    </button>
  );
});
ActionButton.displayName = "ActionButton";

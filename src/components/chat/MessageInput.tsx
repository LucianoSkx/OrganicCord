import { useMediaMemoryGuard } from "@/hooks/useMediaMemoryGuard";
import { useShallow } from "zustand/react/shallow";
import { lazy, Suspense, useState, useRef, useCallback, useEffect, useMemo, type KeyboardEvent } from "react";
import type { DiscordMessage } from "@/types";
import { getDisplayName } from "@/lib/utils";
import { Reply, X, Plus, File as FileIcon, Smile, Mic, Trash2, Send } from "lucide-react";
import type { EmojiClickData } from "emoji-picker-react";
import * as Popover from "@radix-ui/react-popover";
import { useNavigationStore } from "@/stores/navigationStore";
import { useDiscordStore } from "@/stores/discordStore";
import { OrganicMark } from "@/components/ui/OrganicMark";
import { DiscordEmojiPicker } from "./DiscordEmojiPicker";

import { toast } from "@/components/ui/Toast";
import { listen } from "@tauri-apps/api/event";
import { selectAttachment } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";
import { customEmojiCode, listCustomEmojiMatches, parseCustomEmojiToken, resolveEmojiToken, serializeOutgoingEmojiTokens, type CustomEmoji } from "@/lib/emoji";
import { emojiCatalog } from "@/lib/emoji";
import type { DiscordEmoji } from "@/types";

const EmojiPickerPanel = lazy(() =>
  import("./EmojiPickerPanel").then((module) => ({ default: module.EmojiPickerPanel })),
);

export type AttachmentData = 
  | { type: "file", file: File }
  | { type: "handle", handle: string, name: string, size: number };

interface Props {
  channelId: string;
  replyingTo: DiscordMessage | null;
  onCancelReply: () => void;
  onSend: (content: string, attachment?: AttachmentData) => Promise<void>;
  accountColor?: string;
  externalAttachment?: AttachmentData | null;
  canAttach?: boolean;
}

// ─── Helpers de Emoji Customizado ─────────────────────────────────────────────

function createEmojiImage(emoji: CustomEmoji): HTMLImageElement {
  const image = document.createElement("img");
  image.src = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "webp"}?size=48`;
  image.dataset.emoji = customEmojiCode(emoji);
  image.alt = `:${emoji.name}:`;
  image.title = image.alt;
  Object.assign(image.style, { width: "22px", height: "22px", verticalAlign: "middle", margin: "0 2px", display: "inline-block", pointerEvents: "none", userSelect: "all" });
  return image;
}

function insertAtCaret(editor: HTMLElement, content: Node): void {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    const last = content instanceof DocumentFragment ? content.lastChild : content;
    editor.append(content);
    if (last) {
      const end = document.createRange();
      end.setStartAfter(last);
      end.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(end);
    }
    return;
  }
  range.deleteContents();
  const last = content instanceof DocumentFragment ? content.lastChild : content;
  range.insertNode(content);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

function replaceBeforeCaret(editor: HTMLElement, length: number, emoji: CustomEmoji, trailingSpace = false): boolean {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  const offset = selection?.anchorOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE || !editor.contains(node) || offset < length) return false;
  const range = document.createRange();
  range.setStart(node, offset - length);
  range.setEnd(node, offset);
  range.deleteContents();
  const image = createEmojiImage(emoji);
  range.insertNode(image);
  if (trailingSpace) {
    const space = document.createTextNode(" ");
    image.after(space);
    range.setStartAfter(space);
  } else {
    range.setStartAfter(image);
  }
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function emojiFragment(text: string, groups: Record<string, DiscordEmoji[]> | null, guildId: string | null): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const pattern = /(<a?:[\w-]+:\d+>|<\d+:[\w-]+:?>|:[\w-]+:)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) fragment.append(document.createTextNode(text.slice(last, index)));
    const emoji = resolveEmojiToken(match[0], groups, guildId);
    fragment.append(emoji ? createEmojiImage(emoji) : document.createTextNode(match[0]));
    last = index + match[0].length;
  }
  if (last < text.length) fragment.append(document.createTextNode(text.slice(last)));
  return fragment;
}

function getRawContentFromEditable(el: HTMLElement): string {
  let result = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.nodeValue || "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName === "IMG" && element.getAttribute("data-emoji")) {
        result += element.getAttribute("data-emoji");
      } else if (element.tagName === "BR") {
        result += "\n";
      } else if (element.tagName === "DIV" || element.tagName === "P") {
        result += "\n" + getRawContentFromEditable(element);
      } else {
        result += getRawContentFromEditable(element);
      }
    }
  });
  return result;
}

export function MessageInput({
  channelId,
  replyingTo,
  onCancelReply,
  onSend,
  accountColor = "var(--brand-500)",
  externalAttachment,
  canAttach = true,
}: Props) {
  const [isEmpty, setIsEmpty] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [attachment, setAttachment] = useState<AttachmentData | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [emojiSelection, setEmojiSelection] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (externalAttachment) {
      setAttachment(externalAttachment);
    }
  }, [externalAttachment]);

  const { activeAccountId, activeGuildId } = useNavigationStore(useShallow((s) => ({ activeAccountId: s.activeAccountId, activeGuildId: s.activeGuildId })));
  const guildEmojisRaw = useDiscordStore((s) => activeAccountId ? s.cache.guildEmojis[activeAccountId] : null);
  const emojiMatches = useMemo(() => listCustomEmojiMatches(emojiQuery, guildEmojisRaw, activeGuildId), [emojiQuery, guildEmojisRaw, activeGuildId]);

  const customEmojis = emojiCatalog(guildEmojisRaw);

  useEffect(() => {
    const unlisten = listen<{ progress: number }>("upload-progress", (event) => {
      setUploadProgress(event.payload.progress);
    });
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  useMediaMemoryGuard("recording", isRecording);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>([10, 15, 20, 10, 30, 15, 10]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const recordingGeneration = useRef(0);
  const mounted = useRef(true);
  const [attachmentPreview, setAttachmentPreview] = useState<string>();

  useEffect(() => {
    if (attachment?.type !== "file" || !attachment.file.type.startsWith("image/")) { setAttachmentPreview(undefined); return; }
    const url = URL.createObjectURL(attachment.file);
    setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  const cleanupAudioResources = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recordingGeneration.current += 1;
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      mediaRecorderRef.current = null;
      cleanupAudioResources();
      audioChunksRef.current = [];
    };
  }, [cleanupAudioResources]);

  const startRecording = async () => {
    const generation = ++recordingGeneration.current;
    try {
      cleanupAudioResources();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (!mounted.current || recordingGeneration.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      let mimeType = "audio/ogg;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm;codecs=opus";
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "";
      }

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingSeconds(0);

      // Start timer
      recordTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

      // Web Audio level visualizer
      try {
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 32;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let lastSample = 0;
        const updateLevels = (time = performance.now()) => {
          if (!mediaStreamRef.current || audioCtx.state === "closed") return;
          if (time - lastSample < 80 || document.visibilityState !== "visible") {
            animFrameRef.current = requestAnimationFrame(updateLevels);
            return;
          }
          lastSample = time;
          analyser.getByteFrequencyData(dataArray);
          const sliced = Array.from(dataArray.slice(0, 12)).map((v) => Math.max(10, Math.floor((v / 255) * 28)));
          setAudioLevels(sliced);
          animFrameRef.current = requestAnimationFrame(updateLevels);
        };
        updateLevels();
      } catch (err) {
        console.warn("[audio] Visualizer non-critical error:", err);
      }
    } catch (err) {
      console.error("[audio] Error accessing microphone:", err);
      cleanupAudioResources();
      if (!mounted.current) return;
      toast.error("Não foi possível acessar o microfone. Verifique a privacidade de áudio do Windows.");
    }
  };

  const cancelRecording = () => {
    recordingGeneration.current += 1;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    cleanupAudioResources();
    setIsRecording(false);
    setRecordingSeconds(0);
    audioChunksRef.current = [];
  };

  const stopAndSendRecording = async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive" || !activeAccountId) return;

    setSending(true);

    const generation = recordingGeneration.current;
    const destination = { accountId: activeAccountId, channelId, replyId: replyingTo?.id };
    const recorder = mediaRecorderRef.current;
    const finalMime = recorder.mimeType || "audio/ogg";

    const audioBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: finalMime });
        resolve(blob);
      };
      recorder.stop();
    });

    cleanupAudioResources();
    if (!mounted.current || recordingGeneration.current !== generation) return;
    setIsRecording(false);

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioUint8 = new Uint8Array(arrayBuffer);

      let durationSecs = recordingSeconds;
      let base64Waveform = "";

      let decodeCtx: AudioContext | null = null;
      try {
        decodeCtx = new AudioContext();
        const decodedBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
        durationSecs = decodedBuffer.duration;
        const pcmData = decodedBuffer.getChannelData(0);

        const sampleCount = 256;
        const step = Math.max(1, Math.floor(pcmData.length / sampleCount));
        const waveformBytes = new Uint8Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
          let maxVal = 0;
          const start = i * step;
          const end = Math.min(pcmData.length, (i + 1) * step);
          for (let j = start; j < end; j++) {
            const abs = Math.abs(pcmData[j] || 0);
            if (abs > maxVal) maxVal = abs;
          }
          waveformBytes[i] = Math.min(255, Math.floor(maxVal * 255));
        }

        let binaryStr = "";
        for (let i = 0; i < waveformBytes.length; i++) {
          binaryStr += String.fromCharCode(waveformBytes[i]);
        }
        base64Waveform = btoa(binaryStr);
      } catch (err) {
        console.warn("[audio] PCM waveform generation fallback:", err);
      } finally {
        if (decodeCtx && decodeCtx.state !== "closed") {
          decodeCtx.close().catch(() => {});
        }
      }

      if (!mounted.current || recordingGeneration.current !== generation) return;
      await useDiscordStore
        .getState()
        .sendVoiceMessage(destination.accountId, destination.channelId, audioUint8, durationSecs, base64Waveform, destination.replyId);

      if (replyingTo) onCancelReply();
    } catch (err) {
      console.error("[audio] Error sending voice message:", err);
    } finally {
      if (mounted.current) { setSending(false); setRecordingSeconds(0); }
      audioChunksRef.current = [];
    }
  };

  const updateStateFromEditable = useCallback(() => {
    if (!editorRef.current) return;
    const raw = getRawContentFromEditable(editorRef.current);
    setIsEmpty(raw.trim().length === 0);
  }, []);

  const insertEmojiString = useCallback((emojiStr: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();

    const parsed = parseCustomEmojiToken(emojiStr);
    if (parsed) {
      const fragment = document.createDocumentFragment();
      fragment.append(createEmojiImage(parsed), document.createTextNode(" "));
      insertAtCaret(editorRef.current, fragment);
    } else {
      document.execCommand("insertText", false, emojiStr + " ");
    }
    setEmojiQuery("");
    updateStateFromEditable();
  }, [updateStateFromEditable]);

  const chooseEmojiSuggestion = useCallback((emoji: CustomEmoji) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const beforeCaret = node?.nodeType === Node.TEXT_NODE ? (node.nodeValue ?? "").slice(0, selection?.anchorOffset ?? 0) : "";
    const token = /:[\w-]*$/.exec(beforeCaret)?.[0];
    if (token) replaceBeforeCaret(editor, token.length, emoji, true);
    else insertAtCaret(editor, createEmojiImage(emoji));
    editor.focus();
    setEmojiQuery("");
    updateStateFromEditable();
  }, [updateStateFromEditable]);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    let toInsert = emojiData.emoji;
    if (emojiData.isCustom) {
      const isAnimated = emojiData.imageUrl.includes(".gif");
      const emojiName = emojiData.names?.[0] || "emoji";
      toInsert = `<${isAnimated ? "a" : ""}:${emojiName}:${emojiData.unified}>`;
    }
    insertEmojiString(toInsert);
    setPickerOpen(false);
  };

  const handleSend = useCallback(async () => {
    if (!editorRef.current) return;
    const rawContent = serializeOutgoingEmojiTokens(
      getRawContentFromEditable(editorRef.current),
      guildEmojisRaw,
      activeGuildId,
    ).trim();
    if ((!rawContent && !attachment) || sending) return;

    setSending(true);
    try {
      await onSend(rawContent, attachment || undefined);
      if (editorRef.current) {
        editorRef.current.innerHTML = "";
        setIsEmpty(true);
      }
      setAttachment(null);
    } catch {
      // Erro já tratado no discordStore (mensagem do Clyde) — não limpa o campo
    } finally {
      setSending(false);
      setUploadProgress(null);
      setTimeout(() => {
        editorRef.current?.focus();
      }, 0);
    }
  }, [attachment, sending, onSend, guildEmojisRaw, activeGuildId]);

  const lastTypingRef = useRef<number>(0);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    const rawContent = getRawContentFromEditable(editorRef.current);
    setIsEmpty(rawContent.trim().length === 0);

    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const beforeCaret = node?.nodeType === Node.TEXT_NODE ? (node.nodeValue ?? "").slice(0, selection?.anchorOffset ?? 0) : "";
    const completed = /(<a?:[\w-]+:\d+>|<\d+:[\w-]+:?>|:[\w-]+:)$/.exec(beforeCaret)?.[0];
    const resolved = completed ? resolveEmojiToken(completed, guildEmojisRaw, activeGuildId) : null;
    if (completed && resolved && replaceBeforeCaret(editorRef.current, completed.length, resolved)) {
      setEmojiQuery("");
    } else {
      const partial = /(?:^|[\s(]):([\w-]{1,32})$/.exec(beforeCaret);
      setEmojiQuery(partial?.[1] ?? "");
      setEmojiSelection(0);
    }

    if (rawContent.length > 0 && activeAccountId) {
      const now = Date.now();
      if (now - lastTypingRef.current > 5000) {
        lastTypingRef.current = now;
        invoke("trigger_typing", { accountId: activeAccountId, channelId }).catch(console.error);
      }
    }
  }, [channelId, activeAccountId, activeGuildId, guildEmojisRaw]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (emojiMatches.length) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setEmojiSelection((index) => (index + (e.key === "ArrowDown" ? 1 : -1) + emojiMatches.length) % emojiMatches.length);
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          chooseEmojiSuggestion(emojiMatches[emojiSelection] ?? emojiMatches[0]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setEmojiQuery("");
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape" && replyingTo) {
        onCancelReply();
      }
    },
    [handleSend, replyingTo, onCancelReply, emojiMatches, emojiSelection, chooseEmojiSuggestion]
  );

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      const file = e.clipboardData.files[0];
      if (file.size > 25 * 1024 * 1024) {
        toast.warning("Arquivos acima de 25 MB não podem ser enviados pelo OrganicCord.");
        e.preventDefault();
        return;
      }
      setAttachment({ type: "file", file });
      e.preventDefault();
      return;
    }

    // Paste as DOM nodes so escaped tags and arbitrary text stay safe.
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (editorRef.current) insertAtCaret(editorRef.current, emojiFragment(text, guildEmojisRaw, activeGuildId));
    setEmojiQuery("");
    updateStateFromEditable();
  }, [updateStateFromEditable, guildEmojisRaw, activeGuildId]);

  const handleAttachClick = async () => {
    if (!canAttach) {
      toast.error("Você não tem permissão para anexar arquivos neste canal.");
      return;
    }
    try {
      const selected = await selectAttachment();
      if (selected) {
        setAttachment({ type: "handle", ...selected });
      }
    } catch (err) {
      toast.error(String(err).replace(/^Error:\s*/, ""));
    }
  };

  return (
    <div
      style={{
        padding: "0 16px 24px",
        flexShrink: 0,
      }}
    >
      {/* Reply preview */}
      {replyingTo && (
        <div
          style={{
            background: "var(--bg-secondary)",
            borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            borderBottom: "1px solid var(--border-subtle)",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Reply size={14} />
            <span>
              Respondendo para{" "}
              <strong style={{ color: "var(--text-normal)" }}>
                {getDisplayName(replyingTo.author)}
              </strong>
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 300,
                opacity: 0.7,
              }}
            >
              {replyingTo.content.slice(0, 80) || "[anexo]"}
            </span>
          </div>
          <button
            onClick={onCancelReply}
            className="cancel-reply-btn"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Attachment Preview */}
      {attachment && (
        <div
          style={{
            background: "var(--bg-secondary)",
            borderRadius: replyingTo
              ? "0"
              : "var(--radius-md) var(--radius-md) 0 0",
            padding: "16px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              position: "relative",
              width: 64,
              height: 64,
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
              background: "var(--bg-tertiary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {(attachment.type === "file" && attachment.file.type.startsWith("image/")) ? (
              <img
                src={attachmentPreview}
                alt="attachment"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <FileIcon size={24} color="var(--text-muted)" />
            )}
            <button
              onClick={() => {
                setAttachment(null);
              }}
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                background: "rgba(0,0,0,0.6)",
                border: "none",
                borderRadius: "50%",
                width: 20,
                height: 20,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <X size={12} />
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-normal)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {attachment.type === "file" ? attachment.file.name : attachment.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {(attachment.type === "file" ? attachment.file.size : attachment.size) / 1024 / 1024 < 0.01
                ? "< 0.01"
                : ((attachment.type === "file" ? attachment.file.size : attachment.size) / 1024 / 1024).toFixed(2)} MB
            </div>
          </div>
        </div>
      )}

      {/* Input box */}
      <div
        style={{
          background: "var(--bg-accent)",
          borderRadius: replyingTo || attachment
            ? "0 0 var(--radius-md) var(--radius-md)"
            : "var(--radius-md)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          border: "1px solid transparent",
          transition: "border-color 150ms",
          minHeight: 44,
        }}
        onFocusCapture={(e) =>
          ((e.currentTarget as HTMLDivElement).style.borderColor = accountColor)
        }
        onBlurCapture={(e) =>
          ((e.currentTarget as HTMLDivElement).style.borderColor = "transparent")
        }
      >
        {isRecording ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: 44,
              padding: "0 4px",
              userSelect: "none",
            }}
          >
            {/* Recording indicator & timer */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "var(--status-danger)",
                  boxShadow: "0 0 8px var(--status-danger)",
                }}
              />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--status-danger)",
                  fontFamily: "monospace",
                }}
              >
                {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
              </span>

              {/* Live Waveform Audio Levels */}
              <div style={{ display: "flex", alignItems: "center", gap: 3, height: 24, marginLeft: 8 }}>
                {audioLevels.map((lvl, i) => (
                  <div
                    key={i}
                    style={{
                      width: 3,
                      height: `${lvl}px`,
                      maxHeight: 24,
                      background: "var(--status-danger)",
                      borderRadius: 2,
                      transition: "height 50ms ease",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Cancel & Send Buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={cancelRecording}
                title="Cancelar áudio"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: 6,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                className="hover-color-danger"
              >
                <Trash2 size={20} />
              </button>

              <button
                onClick={stopAndSendRecording}
                disabled={sending}
                title="Enviar mensagem de voz"
                style={{
                  background: "var(--brand-500)",
                  border: "none",
                  borderRadius: "50%",
                  width: 32,
                  height: 32,
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                className="hover-opacity"
              >
                <Send size={16} style={{ marginLeft: 2 }} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={handleAttachClick}
              title={canAttach ? "Enviar um arquivo" : "Sem permissão para anexar arquivos neste canal"}
              style={{
                background: "var(--bg-tertiary)",
                border: "none",
                borderRadius: "50%",
                width: 32,
                height: 32,
                cursor: canAttach ? "pointer" : "not-allowed",
                opacity: canAttach ? 1 : 0.4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: "var(--text-normal)",
                transition: "all 150ms",
                marginTop: 6,
                marginBottom: 6,
              }}
              className={canAttach ? "hover-bg-modifier-selected" : undefined}
            >
              <Plus size={16} />
            </button>

            {/* ContentEditable Visual Emoji Input */}
            <div style={{ flex: 1, position: "relative", minHeight: 44, display: "flex", alignItems: "center" }}>
              {isEmpty && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 12,
                    color: "var(--text-muted)",
                    fontSize: 15,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  Enviar mensagem...
                </div>
              )}
              <div
                ref={editorRef}
                contentEditable={!sending}
                role="textbox"
                aria-label="Mensagem"
                aria-multiline="true"
                aria-autocomplete="list"
                aria-expanded={emojiMatches.length > 0}
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onBlur={() => setEmojiQuery("")}
                style={{
                  width: "100%",
                  minHeight: 24,
                  maxHeight: 200,
                  overflowY: "auto",
                  color: "var(--text-normal)",
                  fontSize: 15,
                  lineHeight: "20px",
                  padding: "12px 0",
                  outline: "none",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}
              />
              {emojiMatches.length > 0 && (
                <div role="listbox" aria-label="Sugestões de emoji" style={{ position: "absolute", bottom: "100%", left: 0, width: "min(320px, 100%)", maxHeight: 270, overflowY: "auto", padding: 5, background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", boxShadow: "var(--elevation-high)", zIndex: 20 }}>
                  {emojiMatches.map((emoji, index) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={emojiSelection === index}
                      key={emoji.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseEmojiSuggestion(emoji)}
                      style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "7px 9px", border: 0, borderRadius: "var(--radius-sm)", background: emojiSelection === index ? "var(--bg-modifier-hover)" : "transparent", color: "var(--text-normal)", textAlign: "left", cursor: "pointer" }}
                    >
                      <img src={`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "webp"}?size=32`} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
                      :{emoji.name}:
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, marginBottom: 6 }}>
              {/* Botão de Gravar Mensagem de Voz (Mic) */}
              <button
                onClick={startRecording}
                title="Gravar mensagem de voz"
                style={{
                  background: "transparent",
                  border: "none",
                  borderRadius: "50%",
                  width: 32,
                  height: 32,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "var(--text-muted)",
                  transition: "color 150ms",
                }}
                className="hover-color-normal"
              >
                <Mic size={20} />
              </button>

              {activeAccountId ? (
                <DiscordEmojiPicker 
                  accountId={activeAccountId} 
                  onSelect={(emojiStr) => insertEmojiString(emojiStr)} 
                >
                  <button
                    title="Emoji do Servidor"
                    style={{
                      background: "transparent",
                      border: "none",
                      borderRadius: "50%",
                      width: 32,
                      height: 32,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      color: "var(--text-muted)",
                      transition: "color 150ms",
                    }}
                    className="hover-color-normal"
                  >
                    <OrganicMark size={20} />
                  </button>
                </DiscordEmojiPicker>
              ) : (
                <div style={{ width: 32 }} />
              )}

              <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
                <Popover.Trigger asChild>
                  <button
                    title="Adicionar Emoji"
                    style={{
                      background: "transparent",
                      border: "none",
                      borderRadius: "50%",
                      width: 32,
                      height: 32,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      color: "var(--text-muted)",
                      transition: "color 150ms",
                    }}
                    className="hover-color-normal"
                  >
                    <Smile size={20} />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="top" align="end" sideOffset={10} style={{ zIndex: 100 }}>
                    <Suspense fallback={<div style={{ width: 350, height: 450 }} />}>
                      <EmojiPickerPanel
                        onEmojiClick={handleEmojiClick}
                        lazyLoadEmojis={true}
                        searchPlaceHolder="Pesquisar emoji..."
                        customEmojis={customEmojis}
                        customCategoryIcon={<OrganicMark size={16} />}
                      />
                    </Suspense>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              {/* Botão enviar */}
              <button
                onClick={handleSend}
                disabled={isEmpty && !attachment || sending}
                style={{
                  background: (!isEmpty || attachment) && !sending ? accountColor : "transparent",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  width: 32,
                  height: 32,
                  cursor: (!isEmpty || attachment) && !sending ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "background 150ms, opacity 150ms",
                  opacity: (!isEmpty || attachment) && !sending ? 1 : 0.3,
                }}
              >
                <SendIcon />
              </button>
            </div>
          </>
        )}
      </div>

      {sending && uploadProgress !== null && (
        <div style={{ marginTop: 8, height: 4, background: "var(--bg-tertiary)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", background: accountColor, width: "100%", transform: `scaleX(${uploadProgress / 100})`, transformOrigin: "left", transition: "transform 200ms ease-out" }} />
        </div>
      )}

      {/* Dica de atalho */}
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          marginTop: 4,
          paddingLeft: 4,
        }}
      >
        <kbd style={{ fontFamily: "inherit" }}>Enter</kbd> para enviar ·{" "}
        <kbd style={{ fontFamily: "inherit" }}>Shift+Enter</kbd> para nova linha
      </div>
    </div>
  );
}

const SendIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="white"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

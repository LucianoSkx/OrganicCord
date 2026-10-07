import { memo, useRef, useCallback, useState, useMemo, useLayoutEffect } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import { VariableSizeList, type ListChildComponentProps } from "react-window";
import type { DiscordMessage, DiscordChannel } from "@/types";
import { MessageItem } from "./MessageItem";
import { formatMessageDate } from "@/lib/utils";
import { compareMessages } from "@/lib/messageCache";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { MessageSquare, Ban } from "lucide-react";
import { useNavigationStore } from "@/stores/navigationStore";
import { useDiscordStore } from "@/stores/discordStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface Props {
  messages: DiscordMessage[]; isLoading?: boolean; currentUserId: string;
  onLoadMore: () => void; onReply: (message: DiscordMessage) => void;
  onDelete?: (messageId: string) => void; channels?: DiscordChannel[];
}
interface Row { id: string; message: DiscordMessage; date?: string; grouped: boolean }
interface RowData {
  rows: Row[]; currentUserId: string; channels: DiscordChannel[];
  onReply: Props["onReply"]; onDelete?: Props["onDelete"];
  blocked: Set<string>; revealed: Set<string>; reveal: (id: string) => void;
  measure: (id: string, height: number) => void;
}
const EMPTY_CHANNELS: DiscordChannel[] = [];
const estimate = (row: Row) => row.grouped ? 44 : 88;

export function buildMessageRows(messages: DiscordMessage[]): Row[] {
  const sorted = [...messages].sort(compareMessages).reverse();
  return sorted.map((message, index) => {
    const previous = sorted[index - 1];
    const date = formatMessageDate(message.timestamp);
    const previousDate = previous && formatMessageDate(previous.timestamp);
    const ordinary = (m: DiscordMessage) => m.type === undefined || m.type === 0 || m.type === 19;
    const difference = previous ? Date.parse(message.timestamp) - Date.parse(previous.timestamp) : Infinity;
    return { id: message.id, message, date: date !== previousDate ? date : undefined,
      grouped: !!previous && date === previousDate && ordinary(message) && ordinary(previous) &&
        previous.author.id === message.author.id && difference >= 0 && difference < 300_000 };
  });
}

const MessageRow = memo(function MessageRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const ref = useRef<HTMLDivElement>(null);
  const row = data.rows[index];
  const reply = useCallback(() => data.onReply(row.message), [data.onReply, row.message]);
  const remove = useCallback(() => data.onDelete?.(row.id), [data.onDelete, row.id]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => data.measure(row.id, Math.ceil(node.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [row.id, data.measure]);
  return <div style={style} data-message-row={row.id}><div ref={ref} style={{ paddingBottom: 2 }}>
    {row.date && <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 4px" }}>
      <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{row.date}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
    </div>}
    {data.blocked.has(row.message.author.id) && !data.revealed.has(row.id) ?
      <div style={{ margin: "4px 16px", padding: "8px 12px", display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: 13 }}>
        <span><Ban size={14} /> Mensagem de usuário bloqueado</span>
        <button onClick={() => data.reveal(row.id)} style={{ color: "var(--text-link)", background: "transparent", border: 0 }}>Mostrar mensagem</button>
      </div> : <MessageItem message={row.message} isGrouped={row.grouped} isOwn={row.message.author.id === data.currentUserId}
        onReply={reply} onDelete={data.onDelete ? remove : undefined} channels={data.channels} />}
  </div></div>;
});

export function MessageList({ messages, isLoading, currentUserId, onLoadMore, onReply, onDelete, channels = EMPTY_CHANNELS }: Props) {
  const list = useRef<VariableSizeList<RowData>>(null);
  const sizes = useRef(new Map<string, number>());
  const rows = useMemo(() => buildMessageRows(messages), [messages]);
  const rowsRef = useRef(rows);
  const accountId = useNavigationStore((s) => s.activeAccountId);
  const channelId = useNavigationStore((s) => s.activeChannelId);
  const relationships = useDiscordStore((s) => accountId ? s.cache.relationships[accountId] : undefined);
  const appearance = useSettingsStore((s) => `${s.settings.displayMode}:${s.settings.fontSize}:${s.settings.messageSpacing}`);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const blocked = useMemo(() => new Set((relationships ?? []).filter((r) => r.relationship_type === 2).map((r) => r.user.id)), [relationships]);
  const viewport = useRef({ width: 0, offset: 0, nearBottom: true, anchorId: "", within: 0 });
  const initialized = useRef(false);
  const visibleStart = useRef(0);
  const frame = useRef<number>();
  const initialFrame = useRef<number>();
  const resizeFrame = useRef<number>();
  const firstChanged = useRef(Infinity);
  const offsetFor = useCallback((index: number) => {
    let offset = 0;
    for (let i = 0; i < index; i++) {
      const row = rowsRef.current[i];
      offset += sizes.current.get(row.id) ?? estimate(row);
    }
    return offset;
  }, []);
  const restore = useCallback(() => {
    const state = viewport.current;
    if (state.nearBottom) list.current?.scrollToItem(Math.max(0, rowsRef.current.length - 1), "end");
    else {
      const index = rowsRef.current.findIndex((row) => row.id === state.anchorId);
      if (index >= 0) list.current?.scrollTo(offsetFor(index) + state.within);
    }
  }, [offsetFor]);
  const measure = useCallback((id: string, height: number) => {
    if (height <= 0 || sizes.current.get(id) === height) return;
    sizes.current.set(id, height);
    const index = rowsRef.current.findIndex((row) => row.id === id);
    if (index < 0) return;
    firstChanged.current = Math.min(firstChanged.current, index);
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      list.current?.resetAfterIndex(firstChanged.current);
      firstChanged.current = Infinity;
      frame.current = undefined;
      restore();
    });
  }, [restore]);
  useLayoutEffect(() => {
    rowsRef.current = rows;
    const ids = new Set(rows.map((row) => row.id));
    for (const id of sizes.current.keys()) if (!ids.has(id)) sizes.current.delete(id);
    list.current?.resetAfterIndex(0);
    restore();
    if (!initialized.current) {
      if (initialFrame.current !== undefined) cancelAnimationFrame(initialFrame.current);
      initialFrame.current = requestAnimationFrame(() => { restore(); initialized.current = true; });
    }
  }, [rows, restore]);
  useLayoutEffect(() => {
    sizes.current.clear(); list.current?.resetAfterIndex(0); restore();
  }, [appearance, restore]);
  useLayoutEffect(() => () => {
    for (const pending of [frame.current, initialFrame.current, resizeFrame.current]) {
      if (pending !== undefined) cancelAnimationFrame(pending);
    }
  }, []);
  const reveal = useCallback((id: string) => setRevealed((previous) => new Set([...previous, id])), []);
  const data = useMemo<RowData>(() => ({ rows, currentUserId, channels, onReply, onDelete, blocked, revealed, reveal, measure }),
    [rows, currentUserId, channels, onReply, onDelete, blocked, revealed, reveal, measure]);
  if (isLoading && !messages.length) return <LoadingScreen message="Carregando mensagens..." />;
  if (!messages.length) return <div style={{ height: "100%", display: "grid", placeContent: "center", textAlign: "center", gap: 12, color: "var(--text-muted)" }}>
    <MessageSquare size={40} style={{ margin: "auto", opacity: 0.4 }} /><strong>Nenhuma mensagem ainda</strong><span>Seja o primeiro a enviar uma mensagem neste canal!</span>
  </div>;
  return <div style={{ height: "100%", minHeight: 0 }} data-virtual-message-list>
    <AutoSizer onResize={({ width }) => {
      if (viewport.current.width && viewport.current.width !== width) {
        sizes.current.clear(); list.current?.resetAfterIndex(0);
        if (resizeFrame.current !== undefined) cancelAnimationFrame(resizeFrame.current);
        resizeFrame.current = requestAnimationFrame(restore);
      }
      viewport.current.width = width;
    }}>{({ height, width }) => {
      return <VariableSizeList ref={list} height={height} width={width} itemCount={rows.length} itemData={data}
        itemKey={(index, value) => value.rows[index].id} itemSize={(index) => sizes.current.get(rows[index].id) ?? estimate(rows[index])} overscanCount={8}
        onItemsRendered={({ visibleStartIndex }) => {
          visibleStart.current = visibleStartIndex;
        }}
        onScroll={({ scrollOffset, scrollUpdateWasRequested }) => {
          const state = viewport.current;
          state.offset = scrollOffset;
          if (!scrollUpdateWasRequested && initialized.current) {
            state.nearBottom = offsetFor(rows.length) - height - scrollOffset < 100;
            const row = rows[visibleStart.current];
            if (row) { state.anchorId = row.id; state.within = scrollOffset - offsetFor(visibleStart.current); }
            if (accountId && channelId) useDiscordStore.getState().setHistoryExpanded(accountId, channelId, !state.nearBottom);
            if (scrollOffset < 180) onLoadMore();
          }
        }}>{MessageRow}</VariableSizeList>;
    }}</AutoSizer>
  </div>;
}

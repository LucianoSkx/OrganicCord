import React, { useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { createRoot } from "react-dom/client";
import { useDiscordStore } from "../../src/stores/discordStore";
import { useAccountStore } from "../../src/stores/accountStore";
import { useNavigationStore } from "../../src/stores/navigationStore";
import { useSettingsStore } from "../../src/stores/settingsStore";
import { useMessageAudioStore } from "../../src/stores/messageAudioStore";
import { MessageList } from "../../src/components/chat/MessageList";
import { MessageInput, type AttachmentData } from "../../src/components/chat/MessageInput";
import { useChannelMessages } from "../../src/hooks/useChannelMessages";
import type { DiscordMessage, StoredAccount } from "../../src/types";
import "../../src/styles/globals.css";

const counters = { urls: new Set<string>(), tracksStopped: 0, contextsClosed: 0, calls: [] as string[], sent: [] as string[] };
const VoiceVideoSettings = React.lazy(async () => ({ default: (await import("../../src/components/settings/tabs/VoiceVideoSettings")).VoiceVideoSettings }));
const callbacks = new Map<number, Function>();
const remoteMessages = new Map(Array.from({ length: 1000 }, (_, i) => { const item = message(i + 1); return [item.id, item]; }));
const publish = (item: DiscordMessage) => { remoteMessages.set(item.id, item); useDiscordStore.getState().prependMessage("account", "channel", item); };
let callbackId = 0;
Object.assign(window, { __TAURI_INTERNALS__: {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  transformCallback: (fn: Function) => { const id = ++callbackId; callbacks.set(id, fn); return id; },
  unregisterCallback: (id: number) => callbacks.delete(id),
  invoke: async (command: string, args: { before?: string; after?: string } = {}) => {
    counters.calls.push(command);
    if (command === "get_messages") {
      const ordered = [...remoteMessages.values()].sort((a, b) => a.id.localeCompare(b.id));
      if (args.after) return ordered.filter((item) => BigInt(item.id) > BigInt(args.after!)).slice(0, 50).reverse();
      return ordered.reverse().filter((item) => !args.before || BigInt(item.id) < BigInt(args.before)).slice(0, 50);
    }
    if (command === "get_audio_devices") return [];
    if (command === "plugin:event|listen") return callbackId;
    if (command === "plugin:store|load") return 1;
    return null;
  },
} });
Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} } });
const createURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => { const url = createURL(blob); counters.urls.add(url); return url; };
URL.revokeObjectURL = (url) => { counters.urls.delete(url); revokeURL(url); };
let permissionResolve: ((value: MediaStream) => void) | undefined;
let delayedPermission = false;
const stream = () => ({ getTracks: () => [{ stop: () => counters.tracksStopped++ }] }) as unknown as MediaStream;
Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => delayedPermission
  ? new Promise<MediaStream>((resolve) => { permissionResolve = resolve; }) : Promise.resolve(stream()) } });
class Recorder {
  static isTypeSupported() { return true; }
  state = "inactive"; mimeType = "audio/ogg";
  ondataavailable: Function | null = null; onstop: Function | null = null;
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.onstop?.(); }
}
class Context {
  state = "running";
  close() { this.state = "closed"; counters.contextsClosed++; return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() { return { fftSize: 32, frequencyBinCount: 16, getByteFrequencyData(values: Uint8Array) { values.fill(20); }, getByteTimeDomainData(values: Uint8Array) { values.fill(128); } }; }
}
class AudioElement extends EventTarget {
  src = ""; paused = true; currentTime = 0; duration = 60; readyState = 1; preload = "none"; playbackRate = 1;
  async play() { this.paused = false; this.dispatchEvent(new Event("play")); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  load() { this.dispatchEvent(new Event("loadedmetadata")); }
  removeAttribute() { this.src = ""; }
}
Object.assign(window, { MediaRecorder: Recorder, AudioContext: Context, Audio: AudioElement });

function message(id: number): DiscordMessage {
  return { id: String(100000000000000000n + BigInt(id)), channel_id: "channel", content: `Message ${id}`, timestamp: new Date(1728000000000 + id * 1000).toISOString(),
    author: { id: "123456789012345678", username: "Test user", avatar: null, discriminator: "0" }, attachments: [], embeds: [], edited_timestamp: null, pinned: false };
}
useNavigationStore.setState({ activeAccountId: "account", activeChannelId: "channel", activeGuildId: "guild" });
useAccountStore.setState({ accounts: [{ id: "account", user_id: "123456789012345678" } as StoredAccount],
  sessions: { account: { account_id: "account", status: "Connected" } as never } });
useDiscordStore.setState((s) => ({ cache: { ...s.cache, guildEmojis: { account: { guild: [{ id: "123456789012345678", name: "wave", animated: false }] } } } }));
useDiscordStore.getState().activateMessageChannel("account", "channel");
useDiscordStore.setState((s) => ({ cache: { ...s.cache, messages: { "account:channel": Array.from({ length: 1000 }, (_, i) => message(1000 - i)) } } }));

function Fixture() {
  const { messages, isLoading } = useChannelMessages("account", "channel");
  const [generation, change] = useState(0);
  const [attachment, setAttachment] = useState<AttachmentData>();
  const [deviceTests, setDeviceTests] = useState(false);
  Object.assign(window, { __fixture: {
    state: () => ({ urls: counters.urls.size, tracksStopped: counters.tracksStopped, contextsClosed: counters.contextsClosed,
      calls: counters.calls, sent: counters.sent, audio: useMessageAudioStore.getState().playing, focusedImage: useNavigationStore.getState().focusedImage }),
    append: () => publish(message(1001)),
    appearance: (mode: "cozy" | "compact", fontSize: number) => useSettingsStore.setState((s) => ({ settings: { ...s.settings, displayMode: mode, fontSize } })),
    attach: () => setAttachment({ type: "file", file: new File([new Uint8Array([1,2,3])], "preview.png", { type: "image/png" }) }),
    delayedPermission: () => { delayedPermission = true; },
    grant: () => permissionResolve?.(stream()),
    voiceMessage: () => publish({ ...message(1002), content: "", attachments: [{ id: "audio-one", filename: "voice-message.ogg", size: 10, url: "test-audio", proxy_url: "test-audio", content_type: "audio/ogg", duration_secs: 60, waveform: "AAAAAAAAAAA=" }] }),
    imageMessage: () => publish({ ...message(1003), content: "", attachments: [{ id: "image-one", filename: "large-photo.png", size: 10, width: 1200, height: 900, url: "https://cdn.discordapp.com/attachments/a/b/photo.png?ex=expires&hm=signature", proxy_url: "https://media.discordapp.net/attachments/a/b/photo.png?ex=expires&hm=signature", content_type: "image/png" }] }),
  } });
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
    <button onClick={() => { change((n) => n + 1); setAttachment(undefined); setDeviceTests(false); }}>Trocar conversa</button>
    <button onClick={() => setDeviceTests(true)}>Testar dispositivos</button>
    {deviceTests ? <React.Suspense fallback={null}><VoiceVideoSettings /></React.Suspense> : <><div style={{ flex: 1, minHeight: 0 }}><MessageList messages={messages} isLoading={isLoading} currentUserId="user"
      onLoadMore={() => {}} onReply={() => {}} /></div>
    <MessageInput key={generation} channelId="channel" replyingTo={null} onCancelReply={() => {}} externalAttachment={attachment}
      onSend={async (content) => { counters.sent.push(content); }} /></>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Tooltip.Provider><Fixture /></Tooltip.Provider>);

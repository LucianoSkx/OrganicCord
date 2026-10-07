import { create } from "zustand";
import type { Attachment } from "@/types";

interface MessageAudioState {
  id: string | null; accountId: string | null; playing: boolean;
  currentTime: number; duration: number; playbackRate: number;
  toggle: (attachment: Attachment, accountId: string | null) => Promise<void>;
  seek: (attachment: Attachment, accountId: string | null, time: number) => void;
  setRate: (rate: number) => void;
  stop: () => void;
}
let audio: HTMLAudioElement | null = null;
let pendingSeek: number | null = null;

function player() {
  if (audio) return audio;
  const element = new Audio();
  element.preload = "none";
  const update = () => useMessageAudioStore.setState({ playing: !element.paused, currentTime: element.currentTime,
    duration: Number.isFinite(element.duration) ? element.duration : useMessageAudioStore.getState().duration });
  element.addEventListener("timeupdate", update);
  element.addEventListener("play", update);
  element.addEventListener("pause", update);
  element.addEventListener("loadedmetadata", () => {
    if (pendingSeek !== null) { element.currentTime = pendingSeek; pendingSeek = null; }
    update();
  });
  element.addEventListener("ended", () => { element.currentTime = 0; update(); });
  element.addEventListener("error", () => useMessageAudioStore.setState({ playing: false }));
  audio = element;
  return element;
}

function select(attachment: Attachment, accountId: string | null) {
  const element = player();
  if (useMessageAudioStore.getState().id !== attachment.id || useMessageAudioStore.getState().accountId !== accountId) {
    element.pause();
    pendingSeek = null;
    element.src = attachment.url;
    useMessageAudioStore.setState({ id: attachment.id, accountId, playing: false, currentTime: 0, duration: attachment.duration_secs ?? 0 });
  }
  return element;
}

// Playback belongs to the app, so a virtual message row can unmount without
// stopping audio. Only the selected attachment owns a media element.
export const useMessageAudioStore = create<MessageAudioState>((set, get) => ({
  id: null, accountId: null, playing: false, currentTime: 0, duration: 0, playbackRate: 1,
  toggle: async (attachment, accountId) => {
    const element = select(attachment, accountId);
    if (!element.paused) element.pause();
    else {
      element.playbackRate = get().playbackRate;
      await element.play();
    }
  },
  seek: (attachment, accountId, time) => {
    const element = select(attachment, accountId);
    if (element.readyState >= 1) element.currentTime = time;
    else { pendingSeek = time; element.preload = "metadata"; element.load(); }
    set({ currentTime: time });
  },
  setRate: (rate) => { if (audio) audio.playbackRate = rate; set({ playbackRate: rate }); },
  stop: () => {
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    pendingSeek = null;
    set({ id: null, accountId: null, playing: false, currentTime: 0, duration: 0 });
  },
}));

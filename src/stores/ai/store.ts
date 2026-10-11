import { create } from "zustand";
import { AiConversationStore } from "./types";

export const useAiConversationStore = create<AiConversationStore>()((_set) => ({
  conversations: [],
  runtimeInfo: {},
  runtimeStatus: {},
  runtimeError: {},
  runtimeRounds: {},
  addConversation: () => {},
  updateConversation: () => {},
  removeConversation: () => {},
  startConversation: () => {},
  stopConversation: () => {},
  addLog: () => {},
  clearLogs: () => {},
  _setInfo: () => {},
  _pushLog: () => {},
  _startCountdown: () => {},
}));

import type { AiConfig } from "@/stores/aiStore";

export type ConversationStatus = "idle" | "running" | "paused" | "error" | "generating";

export interface AiParticipantProfile {
  username: string;
  display_name: string | null;
  user_id: string;
  bio: string | null;
  discriminator: string;
}

export interface AiParticipant {
  id: string;
  account_id: string;
  user_id: string;
  username: string;
  color: string;
  config: AiConfig;
  personality: string;
  delay_base_ms: number;
  delay_jitter_ms: number;
  profile?: AiParticipantProfile | null;
}

export interface OrchestratorConfig {
  enabled: boolean;
  api_key: string;
  interval_turns: number;
  extra_instructions: string;
}

export interface AiConversation {
  id: string;
  label: string;
  channel_id: string;
  account_id: string;
  guild_id: string | null;
  participants: AiParticipant[];
  topic: string;
  enabled: boolean;
  created_at: string;
  context_messages: number;
  orchestrator?: OrchestratorConfig | null;
  drop_reaction_emoji: string;
  drop_response_template: string;
}

export interface ConvLogEntry {
  ts: number;
  conv_id: string;
  participant_id: string;
  participant_name: string;
  participant_color: string;
  type: string;
  text?: string;
  block_index?: number;
  block_total?: number;
}

export interface ConvRuntimeInfo {
  status: ConversationStatus;
  error: string | null;
  rounds: number;
  next_participant_id: string | null;
  next_participant_name: string | null;
  next_participant_color: string | null;
  burst_lock_id: string | null;
  burst_lock_name: string | null;
  countdown_ms: number | null;
  countdown_started_at: number | null;
  countdown_total_ms: number | null;
  is_generating: boolean;
  generating_participant_name: string | null;
  generating_participant_color: string | null;
}

export interface AiConversationStore {
  conversations: AiConversation[];
  runtimeInfo: Record<string, ConvRuntimeInfo>;
  runtimeStatus: Record<string, ConversationStatus>;
  runtimeError: Record<string, string | null>;
  runtimeRounds: Record<string, number>;
  addConversation: (conv: AiConversation) => void;
  updateConversation: (id: string, patch: Partial<AiConversation>) => void;
  removeConversation: (id: string) => void;
  startConversation: (id: string) => void;
  stopConversation: (id: string) => void;
  addLog: (log: ConvLogEntry) => void;
  clearLogs: (id: string) => void;
  _setInfo: (convId: string, patch: Partial<ConvRuntimeInfo>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- logs aceitam campos livres
  _pushLog: (log: any) => void;
  _startCountdown: (convId: string, delayMs: number) => void;
}

/** Tipos de runtime propositalmente permissivos: o motor os lê e muta de forma estrutural. */
/* eslint-disable @typescript-eslint/no-explicit-any -- o formato varia por feature do motor */
export type RuntimeState = any;
export type ChannelMessage = any;
export type ParticipantMemory = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const makeRuntime = (): RuntimeState => ({
  participant_memory: {},
  local_sent: [],
  rounds: 0,
  error: null,
  paused: false,
} as RuntimeState);

export const makeParticipantMemory = (): ParticipantMemory => ({
  user_threads: {},
} as ParticipantMemory);

export const defaultInfo = (): ConvRuntimeInfo => ({
  status: "idle",
  error: null,
  rounds: 0,
  next_participant_id: null,
  next_participant_name: null,
  next_participant_color: null,
  burst_lock_id: null,
  burst_lock_name: null,
  countdown_ms: null,
  countdown_started_at: null,
  countdown_total_ms: null,
  is_generating: false,
  generating_participant_name: null,
  generating_participant_color: null,
});

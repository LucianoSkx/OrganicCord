import { create } from "zustand";
import * as api from "@/lib/tauri";
import { useNavigationStore } from "@/stores/navigationStore";

type PublishedActivity = { accountId: string; signature: string } | null;

interface GameActivityStore {
  settings: api.GameDetectionSettings | null;
  detectedGame: api.DetectedGame | null;
  loading: boolean;
  error: string | null;
  published: PublishedActivity;
  readyAccountIds: string[];
  replayAccountIds: string[];
  loadSettings: () => Promise<void>;
  setDetectionEnabled: (enabled: boolean) => Promise<void>;
  setPublishingEnabled: (enabled: boolean) => Promise<void>;
  saveGame: (game: api.RegisteredGame) => Promise<void>;
  removeGame: (gameId: string) => Promise<void>;
  onGatewayStatus: (accountId: string, status: "connected" | "reconnecting" | "error" | "disconnected") => void;
  refreshAndSync: (detected?: api.DetectedGame | null) => Promise<void>;
  clearPublishedActivity: () => Promise<void>;
}

const signatureFor = (game: api.DetectedGame | null) =>
  game ? `${game.id}:${game.processId}:${game.startedAt}:${game.name}` : null;

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : fallback;

let syncQueue: Promise<void> = Promise.resolve();

export const useGameActivityStore = create<GameActivityStore>((set, get) => ({
  settings: null,
  detectedGame: null,
  loading: false,
  error: null,
  published: null,
  readyAccountIds: [],
  replayAccountIds: [],

  loadSettings: async () => {
    set({ loading: true, error: null });
    try {
      set({ settings: await api.gameDetectionGetSettings(), loading: false });
    } catch (error) {
      set({ loading: false, error: errorMessage(error, "Não foi possível carregar os jogos registrados.") });
    }
  },

  setDetectionEnabled: async (enabled) => {
    try {
      set({ settings: await api.gameDetectionSetEnabled(enabled), error: null });
      await get().refreshAndSync();
    } catch (error) {
      set({ error: errorMessage(error, "Não foi possível atualizar a detecção.") });
      throw error;
    }
  },

  setPublishingEnabled: async (enabled) => {
    try {
      set({ settings: await api.gameDetectionSetPublishEnabled(enabled), error: null });
      await get().refreshAndSync();
    } catch (error) {
      set({ error: errorMessage(error, "Não foi possível atualizar a publicação de jogos.") });
      throw error;
    }
  },

  saveGame: async (game) => {
    try {
      set({ settings: await api.gameDetectionUpdateGame(game), error: null });
    } catch (error) {
      set({ error: errorMessage(error, "Não foi possível salvar o jogo.") });
      throw error;
    }
  },

  removeGame: async (gameId) => {
    try {
      set({ settings: await api.gameDetectionRemoveGame(gameId), error: null });
    } catch (error) {
      set({ error: errorMessage(error, "Não foi possível remover o jogo.") });
      throw error;
    }
  },

  onGatewayStatus: (accountId, status) => {
    const readyAccountIds = get().readyAccountIds.filter((id) => id !== accountId);
    const replayAccountIds = get().replayAccountIds.filter((id) => id !== accountId);
    if (status === "connected") {
      readyAccountIds.push(accountId);
      replayAccountIds.push(accountId);
    }
    set({ readyAccountIds, replayAccountIds });
    void get().refreshAndSync();
  },

  refreshAndSync: async (detected) => {
    const operation = syncQueue.then(async () => {
      try {
        const detectedGame = detected === undefined ? await api.gameDetectionScan() : detected;
        if (signatureFor(get().detectedGame) !== signatureFor(detectedGame)) set({ detectedGame });

        let settings = get().settings;
        if (!settings) {
          settings = await api.gameDetectionGetSettings();
          set({ settings });
        }

        const accountId = useNavigationStore.getState().activeAccountId;
        const ready = accountId !== null && get().readyAccountIds.includes(accountId);
        const signature = settings.enabled && settings.publishEnabled && ready ? signatureFor(detectedGame) : null;
        const previous = get().published;

        if (previous && (previous.accountId !== accountId || !signature)) {
          try {
            await api.gatewaySetGameActivity(previous.accountId, null);
          } catch (error) {
            console.warn("[games] Não foi possível limpar a presença anterior:", error);
          }
          set({ published: null });
        }

        if (!accountId || !signature || !detectedGame) {
          set({
            replayAccountIds: accountId ? get().replayAccountIds.filter((id) => id !== accountId) : get().replayAccountIds,
            error: null,
          });
          return;
        }
        if (previous?.accountId === accountId && previous.signature === signature && !get().replayAccountIds.includes(accountId)) {
          set({ error: null });
          return;
        }

        await api.gatewaySetGameActivity(accountId, {
          name: detectedGame.name,
          startedAt: detectedGame.startedAt,
        });
        set({
          published: { accountId, signature },
          replayAccountIds: get().replayAccountIds.filter((id) => id !== accountId),
          error: null,
        });
      } catch (error) {
        set({ error: errorMessage(error, "Não foi possível enviar a atividade pelo OrganicCord.") });
      }
    });
    syncQueue = operation.catch(() => undefined);
    await operation;
  },

  clearPublishedActivity: async () => {
    const operation = syncQueue.then(async () => {
      const previous = get().published;
      if (!previous) return;
      try {
        await api.gatewaySetGameActivity(previous.accountId, null);
        set({ published: null });
      } catch (error) {
        set({ error: errorMessage(error, "Não foi possível limpar a atividade do jogo.") });
      }
    });
    syncQueue = operation.catch(() => undefined);
    await operation;
  },
}));

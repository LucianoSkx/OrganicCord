import { load, type Store } from "@tauri-apps/plugin-store";

const STORE_PATH = "organiccord_settings.json";

let storePromise: Promise<Store> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<string, unknown>();
let waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

export async function getAppStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_PATH, { defaults: {}, autoSave: false });
  }

  try {
    return await storePromise;
  } catch (error) {
    storePromise = null;
    throw error;
  }
}

export function persistStoreEntries(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void> {
  for (const [key, value] of entries) pending.set(key, structuredClone(value));
  const result = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
  // One bounded delay per burst; continuous slider input cannot postpone saving
  // indefinitely. The latest value of each key wins inside this batch.
  timer ??= setTimeout(() => { void flushAppStore().catch(() => undefined); }, 150);
  return result;
}

export function flushAppStore(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending.size) return writeQueue;
  const snapshot = [...pending];
  const batchWaiters = waiters;
  pending.clear();
  waiters = [];
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    try {
      const store = await getAppStore();
      for (const [key, value] of snapshot) await store.set(key, value);
      await store.save();
      batchWaiters.forEach((waiter) => waiter.resolve());
    } catch (error) {
      batchWaiters.forEach((waiter) => waiter.reject(error));
      throw error;
    }
  });
  return writeQueue;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { void flushAppStore().catch(() => undefined); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAppStore().catch(() => undefined);
  });
}

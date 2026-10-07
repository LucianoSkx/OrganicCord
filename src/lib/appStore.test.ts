import { describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ set: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn().mockResolvedValue(store) }));
import { persistStoreEntries, flushAppStore } from "./appStore";

describe("coalesced settings persistence", () => {
  it("saves the last value per key and flushes before leaving", async () => {
    const first = persistStoreEntries([["settings", { fontSize: 14 }]]);
    const second = persistStoreEntries([["settings", { fontSize: 18 }], ["folders", ["one"]]]);
    await flushAppStore();
    await Promise.all([first, second]);
    expect(store.set).toHaveBeenCalledTimes(2);
    expect(store.set).toHaveBeenCalledWith("settings", { fontSize: 18 });
    expect(store.save).toHaveBeenCalledTimes(1);
  });
  it("reports save failures and can persist a later update", async () => {
    store.save.mockRejectedValueOnce(new Error("Disk unavailable"));
    const failed = persistStoreEntries([["settings", { fontSize: 17 }]]);
    const rejected = expect(failed).rejects.toThrow("Disk unavailable");
    await expect(flushAppStore()).rejects.toThrow("Disk unavailable");
    await rejected;
    const next = persistStoreEntries([["settings", { fontSize: 19 }]]);
    await flushAppStore();
    await next;
    expect(store.set).toHaveBeenLastCalledWith("settings", { fontSize: 19 });
  });
});

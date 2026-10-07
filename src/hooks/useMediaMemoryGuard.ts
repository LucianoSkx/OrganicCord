import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useMediaMemoryGuard(source: "voice" | "recording" | "message-audio" | "device-test", active: boolean) {
  useEffect(() => {
    void invoke("set_webview_media_active", { source, active }).catch(() => undefined);
    return () => { if (active) void invoke("set_webview_media_active", { source, active: false }).catch(() => undefined); };
  }, [source, active]);
}

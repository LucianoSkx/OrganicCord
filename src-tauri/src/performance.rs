use std::collections::HashSet;
use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Mutex};
use tauri::Manager;

#[derive(Default)]
pub struct MemoryPolicy {
    media: Mutex<HashSet<String>>,
    generation: AtomicU64,
    low: AtomicBool,
}

fn should_lower_memory(visible: bool, minimized: bool, media: bool) -> bool {
    (!visible || minimized) && !media
}

pub fn restore(app: &tauri::AppHandle) {
    let state = app.state::<MemoryPolicy>();
    state.generation.fetch_add(1, Ordering::SeqCst);
    apply_target(app, false);
}

pub fn window_changed(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let state = app.state::<MemoryPolicy>();
    let media = state.media.lock().map(|items| !items.is_empty()).unwrap_or(true);
    let low = should_lower_memory(window.is_visible().unwrap_or(true), window.is_minimized().unwrap_or(false), media);
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if !low { apply_target(app, false); return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        if app.state::<MemoryPolicy>().generation.load(Ordering::SeqCst) == generation {
            apply_target(&app, true);
        }
    });
}

fn apply_target(app: &tauri::AppHandle, low: bool) {
    let state = app.state::<MemoryPolicy>();
    if state.low.swap(low, Ordering::SeqCst) == low { return; }
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(move |webview| unsafe {
            use windows_core::Interface;
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            };
            // Best effort: older runtimes can lack this interface. Scripts,
            // notifications and native Gateway connections continue running.
            let result = webview.controller().CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_19>())
                .and_then(|core| core.SetMemoryUsageTargetLevel(if low {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL }));
            match result {
                Ok(()) => log::info!("[performance] WebView memory target={}", if low { "low" } else { "normal" }),
                Err(error) => log::debug!("[performance] WebView memory hint unavailable: {error}"),
            }
        });
    }
}

#[tauri::command]
pub fn set_webview_media_active(source: String, active: bool, app: tauri::AppHandle, window: tauri::Window) -> Result<(), String> {
    if window.label() != "main" || !matches!(source.as_str(), "voice" | "recording" | "message-audio" | "device-test") {
        return Err("Invalid media source".into());
    }
    let state = app.state::<MemoryPolicy>();
    let mut media = state.media.lock().map_err(|_| "Media state unavailable")?;
    if active { media.insert(source); } else { media.remove(&source); }
    drop(media);
    window_changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_lower_memory;
    #[test]
    fn media_and_visible_windows_keep_normal_memory_policy() {
        assert!(!should_lower_memory(true, false, false));
        assert!(!should_lower_memory(false, false, true));
        assert!(!should_lower_memory(true, true, true));
        assert!(should_lower_memory(false, false, false));
        assert!(should_lower_memory(true, true, false));
    }
}

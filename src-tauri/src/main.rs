// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK com o compositing acelerado dropa tiles de regiões estáticas
    // (sidebar de canais/guilds) durante scroll rápido na lista de mensagens.
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    organic_cord_lib::run();
}

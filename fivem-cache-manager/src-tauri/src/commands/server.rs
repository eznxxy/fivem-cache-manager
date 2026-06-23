// FiveM Cache Manager — server.rs
// Tauri command: server_selected
// Receives the server name + join URL from the content script via invoke(),
// then notifies the injected action bar (content_script.js).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Payload received from the WebView content script when a user clicks Join/Connect
#[derive(Debug, Deserialize)]
pub struct ServerSelectedPayload {
    pub server_name: String,
    pub join_url: String,
}

/// Payload emitted to the WebView so the injected action bar updates
#[derive(Debug, Serialize, Clone)]
pub struct ServerDetectedEvent {
    #[serde(rename = "serverName")]
    pub server_name: String,
    #[serde(rename = "joinUrl")]
    pub join_url: String,
}

/// Push server info to the injected action bar via webview.eval().
/// `app.emit` alone is unreliable on external URL webviews — eval is the primary path.
pub fn notify_action_bar(app: &AppHandle, server_name: &str, join_url: &str) {
    let server_name = server_name.trim();
    let join_url = join_url.trim();

    if let Some(win) = app.get_webview_window("main") {
        let sn = serde_json::to_string(server_name).unwrap_or_else(|_| "\"Unknown Server\"".into());
        let ju = serde_json::to_string(join_url).unwrap_or_else(|_| "\"\"".into());
        let script = format!("window.__fcmOnServerSelected?.({sn}, {ju});", sn = sn, ju = ju);
        if let Err(e) = win.eval(script) {
            println!("[CacheManager] action bar eval failed: {e}");
        }
    }

    let event = ServerDetectedEvent {
        server_name: server_name.to_string(),
        join_url: join_url.to_string(),
    };
    if let Err(e) = app.emit_to("main", "server-detected", event) {
        println!("[CacheManager] emit_to server-detected failed: {e}");
    }
}

/// Fallback when Rust intercepts fivem:// navigation — extract server name from page DOM.
pub fn notify_fallback_join(app: &AppHandle, join_url: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let ju = serde_json::to_string(join_url.trim()).unwrap_or_else(|_| "\"\"".into());
        let script = format!("window.__fcmHandleFallbackJoin?.({ju});", ju = ju);
        if let Err(e) = win.eval(script) {
            println!("[CacheManager] fallback eval failed: {e}");
        }
    }
}

/// Tauri command: called by the content script when a Join/Connect button is clicked.
/// UI is already updated in JS before invoke — this handler logs for Rust-side tracing.
#[tauri::command]
pub fn serverselected(server_name: String, join_url: String) -> Result<(), String> {
    println!(
        "[CacheManager] server_selected — name: {:?} | url: {:?}",
        server_name, join_url
    );

    if server_name.trim().is_empty() && join_url.trim().is_empty() {
        return Err("Received empty server_name and join_url".into());
    }

    Ok(())
}

/// Tauri command: Opens a URL (like fivem://) directly from Rust to bypass frontend scope restrictions
#[tauri::command]
pub fn openserver(_app: AppHandle, url: String) -> Result<(), String> {
    println!("[CacheManager] Opening URL from Rust: {}", url);
    
    // FiveM strictly requires being launched from a shell (Explorer) or a web browser.
    // tauri_plugin_opener sets our app as the parent, which triggers FiveM's anti-tamper error.
    // Using `explorer.exe` explicitly acts as the shell.
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Gagal menjalankan explorer: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_opener::OpenerExt;
        _app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| format!("Gagal membuka FiveM: {}", e))
    }
}

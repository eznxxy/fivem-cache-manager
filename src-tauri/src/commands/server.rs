// FiveM Cache Manager — server.rs
// Tauri command: server_selected
// Receives the server name + join URL from the content script via invoke(),
// then notifies the injected action bar (content_script.js).

use tauri::{AppHandle, Manager};


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
            .map_err(|e| format!("Failed to launch explorer: {}", e))?;
            
        // Minimize the app automatically after launching FiveM
        if let Some(win) = _app.get_webview_window("main") {
            let _ = win.minimize();
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_opener::OpenerExt;
        _app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| format!("Failed to open FiveM: {}", e))
    }
}

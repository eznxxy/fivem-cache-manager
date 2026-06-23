// FiveM Cache Manager — Tauri v2 backend entry point
// Architecture: Single WebviewWindow loading servers.fivem.net
//   - initialization_script injects: content script (intercept Join) + action bar UI
//   - Action bar is rendered as a fixed overlay injected into the FiveM page DOM

mod commands;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Combined script: action bar UI injection + server join interceptor.
/// Injected into every cfx.re page load inside the WebView.
const CONTENT_SCRIPT: &str = include_str!("content_script.js");

/// Allowed navigation domains — non-http schemes (fivem://, steam://) are
/// handled separately: WebView2 can't navigate them anyway, so we block + emit.
fn is_allowed_domain(url: &url::Url) -> bool {
    let scheme = url.scheme();

    // Allow standard web schemes for cfx.re ecosystem
    if scheme == "http" || scheme == "https" {
        let host = url.host_str().unwrap_or("");
        return host.ends_with("fivem.net")
            || host.ends_with("cfx.re")
            || host.ends_with("cloudflare.com")
            || host.ends_with("cloudflareinsights.com")
            || host.ends_with("googleapis.com")
            || host.ends_with("gstatic.com");
    }

    // Block all other schemes (fivem://, steam://, etc.) — we handle them via IPC
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::config::loadconfig,
            commands::config::saveconfig,
            commands::server::serverselected,
            commands::server::openserver,
            commands::cache::swapcache,
            commands::cache::getserverfolders,
            commands::system::check_prerequisites,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Build the main window with servers.fivem.net as the starting URL.
            // The action bar overlay is injected via initialization_script (content_script.js).
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(
                    "https://servers.fivem.net/"
                        .parse()
                        .expect("valid URL"),
                ),
            )
            .title("FiveM Cache Manager")
            .inner_size(1200.0, 800.0)
            .resizable(true)
            .center()
            // Inject content script + action bar UI into every page load
            .initialization_script(CONTENT_SCRIPT)
            // Navigation policy: block external domains + fivem:// custom scheme
            .on_navigation(move |url| {
                let allowed = is_allowed_domain(url);
                if !allowed {
                    let scheme = url.scheme();
                    if scheme == "fivem" || scheme == "steam" {
                        // Fallback: content script didn't intercept this click.
                        // Push to action bar via webview.eval (emit alone is unreliable here).
                        let connect_url = url.to_string();
                        println!(
                            "[CacheManager] fivem:// navigation intercepted (fallback): {}",
                            connect_url
                        );
                        commands::server::notify_fallback_join(&app_handle, &connect_url);
                    } else {
                        println!(
                            "[CacheManager] Navigation blocked: {} — redirecting to servers.fivem.net",
                            url
                        );
                        if let Ok(home) = "https://servers.fivem.net/".parse() {
                            if let Some(win) = app_handle.get_webview_window("main") {
                                let _ = win.navigate(home);
                            }
                        }
                    }
                }
                allowed
            })
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// commands/config.rs — AppConfig struct + load/save Tauri commands
// Covers T-09 (Fase 3): AppConfig struct, load_config, save_config

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Application configuration — persisted to app data dir as config.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Absolute path to FiveM data directory (contains cache/, server-cache/, etc.)
    pub fivem_data_path: String,

    /// If true, automatically extract server name from clicked server card
    pub auto_detect_server: bool,

    /// If true, move existing root-level cache back to previous server folder before swapping
    pub restore_previous_cache: bool,

    /// Name of the last-used server folder (for restore-previous logic)
    pub last_used_folder: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        // Default FiveM path: %LOCALAPPDATA%\FiveM\FiveM.app\data
        let default_path = dirs_default_fivem_path();
        Self {
            fivem_data_path: default_path,
            auto_detect_server: true,
            restore_previous_cache: true,
            last_used_folder: None,
        }
    }
}

/// Resolve default FiveM data directory.
/// Priority:
///   1. D:\Games\FiveM\FiveM.app\data  (user's custom install per backlog)
///   2. %LOCALAPPDATA%\FiveM\FiveM.app\data  (standard install)
///   3. C:\Users\Default\... (absolute fallback)
fn dirs_default_fivem_path() -> String {
    // Priority 1: user's custom install location
    let custom = PathBuf::from(r"D:\Games\FiveM\FiveM.app\data");
    if custom.exists() {
        return custom.to_string_lossy().into_owned();
    }

    // Priority 2: standard %LOCALAPPDATA% install
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(local)
            .join("FiveM")
            .join("FiveM.app")
            .join("data");
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
        // Return the %LOCALAPPDATA% path even if it doesn't exist yet
        return p.to_string_lossy().into_owned();
    }

    // Priority 3: absolute fallback
    String::from(r"D:\Games\FiveM\FiveM.app\data")
}

/// Return path to config.json in Tauri app data directory
fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    Ok(data_dir.join("config.json"))
}

/// Tauri command: load config from disk (or return defaults if file doesn't exist)
#[tauri::command]
pub fn loadconfig(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;

    if !path.exists() {
        // First run — return defaults (don't write yet, user may configure in Settings)
        return Ok(AppConfig::default());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config.json: {e}"))?;

    serde_json::from_str::<AppConfig>(&raw)
        .map_err(|e| format!("Failed to parse config.json: {e}"))
}

/// Tauri command: save config to disk
#[tauri::command]
pub fn saveconfig(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let path = config_path(&app)?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write config.json: {e}"))?;

    Ok(())
}

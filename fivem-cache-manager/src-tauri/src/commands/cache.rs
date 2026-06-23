// commands/cache.rs — Commands for scanning server cache folders and swapping cache

use std::path::{Path, PathBuf};
use tauri::AppHandle;
use super::config::{loadconfig, saveconfig};
use super::fuzzy::fuzzy_match;

#[derive(serde::Serialize)]
pub struct SwapResult {
    pub success: bool,
    #[serde(rename = "matched_folder")]
    pub matched_folder: Option<String>,
    pub message: String,
}

/// Helper function to safely move directories.
/// Handles existing destination directories by deleting them first,
/// creates parents, and returns user-friendly error messages on failure (e.g. Permission Denied).
fn move_directory(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }

    // If target exists, delete it first to prevent merging/conflicts
    if to.exists() {
        std::fs::remove_dir_all(to)
            .map_err(|e| format!("Gagal menghapus folder tujuan yang sudah ada ({}): {}", to.display(), e))?;
    }

    // Ensure target's parent directory exists
    if let Some(parent) = to.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Gagal membuat folder induk ({}): {}", parent.display(), e))?;
        }
    }

    // Atomic move (rename) on the same drive
    std::fs::rename(from, to).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!(
                "Akses ditolak saat memindahkan {} ke {}. Coba jalankan aplikasi sebagai Administrator.",
                from.display(),
                to.display()
            )
        } else {
            format!("Gagal memindahkan {} ke {}: {}", from.display(), to.display(), e)
        }
    })
}

/// Scan subdirectories in FiveM data folder that contains cache folders.
#[tauri::command]
pub fn getserverfolders(app: AppHandle) -> Result<Vec<String>, String> {
    let config = loadconfig(app)?;
    let path = PathBuf::from(&config.fivem_data_path);

    if !path.exists() {
        return Err(format!("Path data FiveM tidak ditemukan: {}", config.fivem_data_path));
    }
    if !path.is_dir() {
        return Err(format!("Path data FiveM bukan merupakan direktori: {}", config.fivem_data_path));
    }

    let mut folders = Vec::new();
    let entries = std::fs::read_dir(&path)
        .map_err(|e| format!("Gagal membaca direktori data FiveM: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Gagal membaca entri direktori: {}", e))?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            let mut has_cache = false;
            for cache_name in &["cache", "server-cache", "server-cache-priv"] {
                if entry_path.join(cache_name).exists() {
                    has_cache = true;
                    break;
                }
            }
            if has_cache {
                if let Some(name) = entry_path.file_name() {
                    folders.push(name.to_string_lossy().into_owned());
                }
            }
        }
    }

    // Sort folders alphabetically
    folders.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(folders)
}

/// Swap FiveM server caches based on the server name.
#[tauri::command]
pub fn swapcache(app: AppHandle, server_name: String) -> Result<SwapResult, String> {
    let mut config = loadconfig(app.clone())?;
    let data_path_str = config.fivem_data_path.clone();
    let data_path = PathBuf::from(&data_path_str);

    if !data_path.exists() {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!("Folder data FiveM tidak ditemukan pada path: {}. Silakan ubah di Settings.", data_path_str),
        });
    }

    // 1. Scan available server folders
    let folders = match getserverfolders(app.clone()) {
        Ok(f) => f,
        Err(e) => {
            return Ok(SwapResult {
                success: false,
                matched_folder: None,
                message: format!("Gagal memindai folder server: {}", e),
            });
        }
    };

    // 2. Find fuzzy match
    let (matched, is_new) = match fuzzy_match(&server_name, &folders) {
        Some(m) => (m, false),
        None => {
            let safe_name: String = server_name.chars()
                .map(|c| match c {
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
                    _ => c,
                })
                .collect();
            let safe_name = safe_name.trim().to_string();

            if safe_name.is_empty() {
                return Ok(SwapResult {
                    success: true,
                    matched_folder: None,
                    message: "Tidak ada folder cache yang cocok dan nama server tidak valid. Masuk tanpa swap.".to_string(),
                });
            }

            let new_folder_path = data_path.join(&safe_name);
            if !new_folder_path.exists() {
                if let Err(e) = std::fs::create_dir_all(&new_folder_path) {
                    return Ok(SwapResult {
                        success: false,
                        matched_folder: None,
                        message: format!("Gagal membuat folder baru ({}): {}", safe_name, e),
                    });
                }
            }
            (safe_name, true)
        }
    };

    // Optimization: If the matched folder is already active, skip move
    if Some(matched.clone()) == config.last_used_folder {
        // Double check that at least one active cache directory exists at root
        let mut active_exists = false;
        for name in &["cache", "server-cache", "server-cache-priv"] {
            if data_path.join(name).exists() {
                active_exists = true;
                break;
            }
        }
        if active_exists {
            return Ok(SwapResult {
                success: true,
                matched_folder: Some(matched),
                message: "Cache untuk server ini sudah aktif (dilewati).".to_string(),
            });
        }
    }

    let cache_names = &["cache", "server-cache", "server-cache-priv"];

    // 3. Restore previous cache (if enabled and last folder is registered)
    if config.restore_previous_cache {
        if let Some(ref last_folder) = config.last_used_folder {
            let last_folder_path = data_path.join(last_folder);
            let mut restore_errors = Vec::new();

            for name in cache_names {
                let active_path = data_path.join(name);
                let target_path = last_folder_path.join(name);
                if active_path.exists() {
                    if let Err(e) = move_directory(&active_path, &target_path) {
                        restore_errors.push(e);
                    }
                }
            }

            if !restore_errors.is_empty() {
                return Ok(SwapResult {
                    success: false,
                    matched_folder: None,
                    message: format!(
                        "Gagal mengembalikan cache sebelumnya ({}): {}",
                        last_folder,
                        restore_errors.join("; ")
                    ),
                });
            }
        }
    }

    // 4. Swap new cache
    let matched_folder_path = data_path.join(&matched);
    let mut swap_errors = Vec::new();
    let mut moved_any = false;

    for name in cache_names {
        let source_path = matched_folder_path.join(name);
        let active_path = data_path.join(name);
        if source_path.exists() {
            if let Err(e) = move_directory(&source_path, &active_path) {
                swap_errors.push(e);
            } else {
                moved_any = true;
            }
        }
    }

    if !swap_errors.is_empty() {
        return Ok(SwapResult {
            success: false,
            matched_folder: Some(matched.clone()),
            message: format!(
                "Gagal memindahkan cache baru ke root (berhasil sebagian={}): {}",
                moved_any,
                swap_errors.join("; ")
            ),
        });
    }

    // 5. Update last_used_folder in config
    config.last_used_folder = Some(matched.clone());
    if let Err(e) = saveconfig(app, config) {
        return Ok(SwapResult {
            success: true, // swap itself succeeded
            matched_folder: Some(matched),
            message: format!("Swap berhasil, tetapi gagal memperbarui file konfigurasi: {}", e),
        });
    }

    let success_msg = if is_new {
        format!("Dibuat & disiapkan folder baru: {}", matched)
    } else {
        format!("Berhasil swap cache ke folder: {}", matched)
    };

    Ok(SwapResult {
        success: true,
        matched_folder: Some(matched),
        message: success_msg,
    })
}

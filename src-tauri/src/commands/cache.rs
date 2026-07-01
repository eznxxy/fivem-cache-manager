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

#[derive(serde::Serialize)]
pub struct CheckResult {
    pub exists: bool,
    #[serde(rename = "matched_folder")]
    pub matched_folder: Option<String>,
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
            .map_err(|e| format!("Failed to delete existing target folder ({}): {}", to.display(), e))?;
    }

    // Ensure target's parent directory exists
    if let Some(parent) = to.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent folder ({}): {}", parent.display(), e))?;
        }
    }

    // Atomic move (rename) on the same drive
    std::fs::rename(from, to).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!(
                "Access denied when moving {} to {}. Try running the application as Administrator.",
                from.display(),
                to.display()
            )
        } else {
            format!("Failed to move {} to {}: {}", from.display(), to.display(), e)
        }
    })
}

/// Scan subdirectories in FiveM data folder that contains cache folders.
#[tauri::command]
pub fn getserverfolders(app: AppHandle) -> Result<Vec<String>, String> {
    let config = loadconfig(app)?;
    let path = PathBuf::from(&config.fivem_data_path);

    if !path.exists() {
        return Err(format!("FiveM data path not found: {}", config.fivem_data_path));
    }
    if !path.is_dir() {
        return Err(format!("FiveM data path is not a directory: {}", config.fivem_data_path));
    }

    let mut folders = Vec::new();
    let entries = std::fs::read_dir(&path)
        .map_err(|e| format!("Failed to read FiveM data directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            if let Some(name_os) = entry_path.file_name() {
                let name = name_os.to_string_lossy().into_owned();
                if name.to_lowercase() == "nui-storage" {
                    continue;
                }

                let mut has_cache = false;
                for cache_name in &["cache", "server-cache", "server-cache-priv"] {
                    if entry_path.join(cache_name).exists() {
                        has_cache = true;
                        break;
                    }
                }

                if has_cache || Some(name.clone()) == config.last_used_folder {
                    folders.push(name);
                }
            }
        }
    }

    // Sort folders alphabetically
    folders.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(folders)
}

/// Check if a cache folder exists for the given server name.
#[tauri::command]
pub fn checkcache(app: AppHandle, server_name: String) -> Result<CheckResult, String> {
    let folders = getserverfolders(app)?;
    let matched = fuzzy_match(&server_name, &folders);
    Ok(CheckResult {
        exists: matched.is_some(),
        matched_folder: matched,
    })
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
            message: format!("FiveM data folder not found at path: {}. Please change it in Settings.", data_path_str),
        });
    }

    // 1. Scan available server folders
    let folders = match getserverfolders(app.clone()) {
        Ok(f) => f,
        Err(e) => {
            return Ok(SwapResult {
                success: false,
                matched_folder: None,
                message: format!("Failed to scan server folders: {}", e),
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
                    message: "No matching cache folder and invalid server name. Joining without swap.".to_string(),
                });
            }

            let new_folder_path = data_path.join(&safe_name);
            if !new_folder_path.exists() {
                if let Err(e) = std::fs::create_dir_all(&new_folder_path) {
                    return Ok(SwapResult {
                        success: false,
                        matched_folder: None,
                        message: format!("Failed to create new folder ({}): {}", safe_name, e),
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
                message: "Cache for this server is already active (skipped).".to_string(),
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
                        "Failed to restore previous cache ({}): {}",
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
                "Failed to move new cache to root (partial success={}): {}",
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
            message: format!("Swap successful, but failed to update configuration file: {}", e),
        });
    }

    let success_msg = if is_new {
        format!("Created & prepared new folder: {}", matched)
    } else {
        format!("Successfully swapped cache to folder: {}", matched)
    };

    Ok(SwapResult {
        success: true,
        matched_folder: Some(matched),
        message: success_msg,
    })
}

// ── Known cache sub-folder names shared across import commands ──
const CACHE_SUBFOLDER_NAMES: &[&str] = &["cache", "server-cache", "server-cache-priv"];

/// Sanitize a user-provided server name to a safe folder name.
fn sanitize_server_name(raw: &str) -> String {
    raw.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Recursively copy a directory tree from `from` to `to`.
/// If `to` already exists it is removed first to avoid merging.
fn copy_directory(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }

    // Remove destination if it already exists
    if to.exists() {
        std::fs::remove_dir_all(to)
            .map_err(|e| format!("Failed to remove existing destination ({}): {}", to.display(), e))?;
    }

    // Ensure parent exists
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dir ({}): {}", parent.display(), e))?;
    }

    let options = fs_extra::dir::CopyOptions {
        copy_inside: true,
        ..Default::default()
    };
    fs_extra::dir::copy(from, to, &options)
        .map_err(|e| format!("Failed to copy {} → {}: {}", from.display(), to.display(), e))?;

    Ok(())
}

/// Import a cache folder from a user-selected source directory into the FiveM data path.
/// Only copies whichever of the known sub-folders (cache, server-cache, server-cache-priv) exist.
#[tauri::command]
pub fn importcache(app: AppHandle, source_path: String, server_name: String) -> Result<SwapResult, String> {
    let config = loadconfig(app.clone())?;
    let data_path = PathBuf::from(&config.fivem_data_path);

    if !data_path.exists() {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!(
                "FiveM data folder not found at: {}. Please update it in Settings.",
                config.fivem_data_path
            ),
        });
    }

    let source = PathBuf::from(&source_path);
    if !source.exists() || !source.is_dir() {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!("Source path does not exist or is not a directory: {}", source_path),
        });
    }

    // Check at least one known sub-folder exists in the source
    let found_any = CACHE_SUBFOLDER_NAMES.iter().any(|name| source.join(name).exists());
    if !found_any {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!(
                "No cache sub-folders found in source (expected: {}). Is this a FiveM cache folder?",
                CACHE_SUBFOLDER_NAMES.join(", ")
            ),
        });
    }

    let safe_name = sanitize_server_name(&server_name);
    if safe_name.is_empty() {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: "Server name is empty or invalid after sanitization.".to_string(),
        });
    }

    let dest_folder = data_path.join(&safe_name);
    if let Err(e) = std::fs::create_dir_all(&dest_folder) {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!("Failed to create destination folder ({}): {}", dest_folder.display(), e),
        });
    }

    let mut copied = Vec::new();
    let mut errors = Vec::new();

    for name in CACHE_SUBFOLDER_NAMES {
        let src_sub = source.join(name);
        if src_sub.exists() {
            let dst_sub = dest_folder.join(name);
            match copy_directory(&src_sub, &dst_sub) {
                Ok(()) => copied.push(*name),
                Err(e) => errors.push(e),
            }
        }
    }

    if !errors.is_empty() {
        return Ok(SwapResult {
            success: false,
            matched_folder: Some(safe_name),
            message: format!("Import partially failed: {}", errors.join("; ")),
        });
    }

    Ok(SwapResult {
        success: true,
        matched_folder: Some(safe_name.clone()),
        message: format!(
            "Imported {} sub-folder(s) into '{}': {}",
            copied.len(),
            safe_name,
            copied.join(", ")
        ),
    })
}

/// Import a cache folder from a ZIP or RAR archive into the FiveM data path.
/// Extracts the archive to a temp directory, then applies the same folder-import logic.
#[tauri::command]
pub fn importcachearchive(app: AppHandle, archive_path: String, server_name: String) -> Result<SwapResult, String> {
    let config = loadconfig(app)?;
    let data_path = PathBuf::from(&config.fivem_data_path);

    if !data_path.exists() {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!(
                "FiveM data folder not found at: {}. Please update it in Settings.",
                config.fivem_data_path
            ),
        });
    }

    let archive_file_path = PathBuf::from(&archive_path);
    if !archive_file_path.exists() {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!("Archive file not found: {}", archive_path),
        });
    }
    
    let ext = archive_file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext != "zip" && ext != "rar" {
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: "Selected file is not a supported archive (.zip or .rar).".to_string(),
        });
    }

    // Create a unique temp directory inside the system temp dir
    let temp_dir = std::env::temp_dir().join(format!("fcm_import_{}", std::process::id()));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clean temp dir: {}", e))?;
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Extract Archive
    if ext == "zip" {
        let file = std::fs::File::open(&archive_file_path)
            .map_err(|e| format!("Failed to open ZIP file: {}", e))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)
                .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;
            let out_path = temp_dir.join(entry.name());

            if entry.name().ends_with('/') {
                std::fs::create_dir_all(&out_path)
                    .map_err(|e| format!("Failed to create dir {}: {}", out_path.display(), e))?;
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create dir {}: {}", parent.display(), e))?;
                }
                let mut out_file = std::fs::File::create(&out_path)
                    .map_err(|e| format!("Failed to create file {}: {}", out_path.display(), e))?;
                std::io::copy(&mut entry, &mut out_file)
                    .map_err(|e| format!("Failed to extract {}: {}", entry.name(), e))?;
            }
        }
    } else if ext == "rar" {
        let archive = rars::ArchiveReader::read_path(&archive_file_path)
            .map_err(|e| format!("Failed to read RAR archive: {:?}", e))?;
        
        archive.extract_to(None, |meta| {
            // Check for malicious paths (e.g. escaping temp_dir)
            let path_str = String::from_utf8_lossy(&meta.name).replace("\\", "/");
            let mut out_path = temp_dir.clone();
            for component in path_str.split('/') {
                if component != ".." && component != "." && !component.is_empty() {
                    out_path.push(component);
                }
            }
            
            if meta.is_directory {
                std::fs::create_dir_all(&out_path).map_err(Into::<rars::Error>::into)?;
                Ok(Box::new(std::io::sink()) as Box<dyn std::io::Write>)
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent).map_err(Into::<rars::Error>::into)?;
                }
                let out_file = std::fs::File::create(&out_path).map_err(Into::<rars::Error>::into)?;
                Ok(Box::new(out_file) as Box<dyn std::io::Write>)
            }
        }).map_err(|e| format!("Failed to extract RAR: {:?}", e))?;
    }

    // Now apply folder-import logic from the extracted root
    let safe_name = sanitize_server_name(&server_name);
    if safe_name.is_empty() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: "Server name is empty or invalid after sanitization.".to_string(),
        });
    }

    // Check that at least one cache sub-folder exists in the extracted root
    let found_any = CACHE_SUBFOLDER_NAMES.iter().any(|name| temp_dir.join(name).exists());
    if !found_any {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!(
                "No cache sub-folders found in archive root (expected: {}). Check the archive structure.",
                CACHE_SUBFOLDER_NAMES.join(", ")
            ),
        });
    }

    let dest_folder = data_path.join(&safe_name);
    if let Err(e) = std::fs::create_dir_all(&dest_folder) {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Ok(SwapResult {
            success: false,
            matched_folder: None,
            message: format!("Failed to create destination folder: {}", e),
        });
    }

    let mut copied = Vec::new();
    let mut errors = Vec::new();

    for name in CACHE_SUBFOLDER_NAMES {
        let src_sub = temp_dir.join(name);
        if src_sub.exists() {
            let dst_sub = dest_folder.join(name);
            match copy_directory(&src_sub, &dst_sub) {
                Ok(()) => copied.push(*name),
                Err(e) => errors.push(e),
            }
        }
    }

    // Always clean up temp dir
    let _ = std::fs::remove_dir_all(&temp_dir);

    if !errors.is_empty() {
        return Ok(SwapResult {
            success: false,
            matched_folder: Some(safe_name),
            message: format!("Archive import partially failed: {}", errors.join("; ")),
        });
    }

    Ok(SwapResult {
        success: true,
        matched_folder: Some(safe_name.clone()),
        message: format!(
            "Imported {} sub-folder(s) from archive into '{}': {}",
            copied.len(),
            safe_name,
            copied.join(", ")
        ),
    })
}

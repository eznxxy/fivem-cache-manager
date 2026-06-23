# Product Requirements Document
## FiveM Cache Manager — Personal Desktop App

**Version:** 1.0  
**Author:** Personal Project  
**Stack:** Tauri v2 (Rust backend + WebView frontend)  
**Target OS:** Windows 10/11  
**Audience:** Personal use only

---

## 1. Overview

A lightweight desktop app that embeds the official Cfx.re server list inside a WebView and automates per-server cache swapping before joining. When the user decides to join a server, the app locates a matching cache folder on disk and moves its contents (`cache`, `server-cache`, `server-cache-priv`) to the FiveM data root so FiveM loads the correct cache on launch.

---

## 2. Problem Statement

FiveM stores cache files in `FiveM\FiveM.app\data\`. When switching between servers, stale or mismatched cache data causes longer loading times or conflicts. Manually cutting and pasting cache folders before each session is tedious. This app removes that manual step entirely.

---

## 3. Goals

| # | Goal |
|---|------|
| G1 | Embed the live Cfx.re server list with no separate browser needed |
| G2 | Detect a matching per-server cache folder automatically |
| G3 | Move the correct cache folders to the FiveM data root with one click |
| G4 | Keep the app minimal — no accounts, no network calls beyond the WebView |

---

## 4. Non-Goals

- No FiveM launcher replacement (user still launches FiveM normally after the cache swap)
- No multi-user support
- No cloud sync
- No mod manager features
- No macOS or Linux support

---

## 5. Architecture

```
┌─────────────────────────────────┐
│         Tauri Window            │
│  ┌───────────────────────────┐  │
│  │  WebView                  │  │
│  │  └─ servers.fivem.net     │  │
│  │       (Cfx.re server list)│  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │  Overlay / Action Bar     │  │
│  │  └─ "Swap Cache & Join"   │  │
│  └───────────────────────────┘  │
└────────────┬────────────────────┘
             │ Tauri Command (IPC)
             ▼
┌─────────────────────────────────┐
│         Rust Backend            │
│  • Read selected server name    │
│  • Scan cache directory         │
│  • Move cache folders           │
│  • Return status to frontend    │
└─────────────────────────────────┘
             │
             ▼
  FiveM\FiveM.app\data\
  ├── cache\               ← moved here
  ├── server-cache\        ← moved here
  ├── server-cache-priv\   ← moved here
  └── <ServerName>\
      ├── cache\           ← source
      ├── server-cache\    ← source
      └── server-cache-priv\ ← source
```

---

## 6. Directory Convention

The app expects cache to be pre-organised by the user in the following structure:

```
FiveM\FiveM.app\data\
│
├── cache\                   ← active (swapped here before joining)
├── server-cache\            ← active
├── server-cache-priv\       ← active
│
├── My RP Server\            ← folder name must match server name
│   ├── cache\
│   ├── server-cache\
│   └── server-cache-priv\
│
└── Another Server\
    ├── cache\
    ├── server-cache\
    └── server-cache-priv\
```

Matching logic: the server name string returned from the Cfx.re page is matched case-insensitively and with special characters stripped against folder names in the data directory.

---

## 7. Features & Requirements

### 7.1 WebView — Server List

| ID | Requirement |
|----|-------------|
| F1.1 | Embed `https://servers.fivem.net/` in a full-window WebView on app launch |
| F1.2 | Allow normal navigation within the Cfx.re domain |
| F1.3 | Inject a small content script that detects when the user clicks a "Connect" or "Join" button on any server card and extracts the server name and IP/join URL |
| F1.4 | Pass the extracted server name to the Rust backend via Tauri IPC before proceeding |

### 7.2 Cache Swap — Rust Backend

| ID | Requirement |
|----|-------------|
| F2.1 | Accept `swap_cache(server_name: String)` Tauri command from the frontend |
| F2.2 | Read the FiveM data path from app config (default: `%LOCALAPPDATA%\FiveM\FiveM.app\data`) |
| F2.3 | Fuzzy-match `server_name` against immediate subdirectories of the data path |
| F2.4 | If a match is found: move `cache`, `server-cache`, and `server-cache-priv` from the matched subfolder to the data root (overwrite if already present at root) |
| F2.5 | Move any existing root-level cache folders back into the matched subfolder before swapping (preserve previous server's cache) |
| F2.6 | Return a `SwapResult { success: bool, matched_folder: Option<String>, message: String }` to the frontend |
| F2.7 | If no matching folder is found, return success = false with a descriptive message; do not block join |

### 7.3 Action Bar (Overlay UI)

| ID | Requirement |
|----|-------------|
| F3.1 | Display a thin persistent bar at the bottom of the window |
| F3.2 | Show current status: idle / folder found / swapping / done / error |
| F3.3 | Show which folder was matched (e.g. "Matched: My RP Server") |
| F3.4 | Show a "Swap & Join" button that triggers the cache swap then opens the FiveM join URL |
| F3.5 | Show a "Join Without Swap" button that skips cache logic and opens the join URL directly |
| F3.6 | Disable buttons during an active swap operation |

### 7.4 Settings

| ID | Requirement |
|----|-------------|
| F4.1 | Configurable FiveM data path (stored in `app_data/config.json`) |
| F4.2 | Toggle: auto-detect server name from page (on by default) |
| F4.3 | Toggle: move existing root cache back to previous server folder before swapping (on by default) |
| F4.4 | Settings accessible from a gear icon in the action bar |

---

## 8. User Flow

```
App launches
    │
    ▼
WebView loads servers.fivem.net
    │
User browses and clicks Join on a server card
    │
    ▼
Content script captures server name + join URL
    │
    ▼
Action bar updates: "Found server: <name>" 
    │
    ├── User clicks "Swap & Join"
    │       │
    │       ▼
    │   Rust: move current root cache → previous server folder
    │   Rust: move <matched folder>/cache* → data root
    │       │
    │       ▼
    │   Action bar: "Done — launching FiveM"
    │       │
    │       ▼
    │   Open fivem://connect/<ip> or join URL
    │
    └── User clicks "Join Without Swap"
            │
            ▼
        Open fivem://connect/<ip> directly
```

---

## 9. Technical Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | Vanilla HTML/CSS/JS (or React — lightweight) |
| Backend | Rust |
| WebView engine | WebView2 (Windows built-in) |
| File operations | `std::fs` + `fs_extra` crate for recursive move |
| Config storage | `tauri-plugin-store` or plain JSON in app data dir |
| IPC | Tauri `invoke()` commands |

---

## 10. Rust Backend — Key Modules

### `commands/swap_cache.rs`
```
pub async fn swap_cache(server_name: String, config: State<AppConfig>) 
  -> Result<SwapResult, String>
```
Steps:
1. List directories in `data_path`
2. Filter to folders that contain at least one of `cache`, `server-cache`, `server-cache-priv`
3. Normalize and fuzzy-match against `server_name`
4. If current root cache folders exist, move them back to the last-used server folder (read from config)
5. Move matched folder's cache dirs to root
6. Save matched folder name as `last_used` in config
7. Return result

### `commands/get_server_folders.rs`
Returns a list of all detected per-server folder names for display in settings.

---

## 11. Frontend — Content Script Injection

The Tauri WebView injects a small JS script on every page load within `servers.fivem.net`:

```javascript
// Injected by Tauri initialization script
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-join-url], .join-btn, button[class*="join"]');
  if (!btn) return;
  
  const serverCard = btn.closest('[data-server-name], .server-card, article');
  const serverName = serverCard?.querySelector('.server-name, h3, [class*="name"]')?.textContent?.trim();
  const joinUrl = btn.dataset.joinUrl || btn.href;

  if (serverName && joinUrl) {
    window.__TAURI__.invoke('server_selected', { serverName, joinUrl });
    e.preventDefault(); // hold — let Rust confirm swap before proceeding
  }
});
```

> **Note:** The Cfx.re DOM structure may change. The selector list above should be treated as a starting point and updated during development by inspecting the live page.

---

## 12. Error Handling

| Scenario | Behavior |
|----------|----------|
| No matching folder found | Warn in action bar, allow "Join Without Swap" |
| File move fails (permission error) | Show error with path, suggest running as admin |
| FiveM data path not found | Prompt user to set path in Settings |
| WebView navigation leaves Cfx.re | Action bar resets to idle state |
| Cache folder partially moved | Log moved items, report partial success |

---

## 13. File & Folder Permissions

The app requires read/write access to `FiveM\FiveM.app\data\`. On most Windows installs this is in `%LOCALAPPDATA%` which doesn't require elevation. If FiveM is installed to `Program Files`, the app should detect this and prompt the user.

---

## 14. Config Schema (`config.json`)

```json
{
  "fivem_data_path": "C:\\Users\\<user>\\AppData\\Local\\FiveM\\FiveM.app\\data",
  "auto_detect_server": true,
  "restore_previous_cache": true,
  "last_used_folder": "My RP Server"
}
```

---

## 15. Out-of-Scope for v1.0

- Automatic folder creation when no match is found
- Backup/restore of cache before destructive moves
- Multiple FiveM installations
- Cache size display
- Search/filter in action bar

---

## 16. Development Milestones

| Phase | Tasks | Est. |
|-------|-------|------|
| 1 | Tauri project setup, WebView loads Cfx.re, basic window | 1 day |
| 2 | Content script injection + `server_selected` IPC command | 1 day |
| 3 | Rust `swap_cache` command + directory scanning logic | 2 days |
| 4 | Action bar UI (status, buttons, matched folder display) | 1 day |
| 5 | Settings page + config read/write | 1 day |
| 6 | Error handling, edge cases, manual testing | 1–2 days |
| **Total** | | **~1 week** |

---

## 17. Testing Checklist

- [ ] App loads `servers.fivem.net` correctly on launch
- [ ] Clicking Join captures correct server name
- [ ] Matching works for server names with special characters / long names
- [ ] Cache folders move correctly from subfolder → data root
- [ ] Previous server's cache is correctly moved back before swap
- [ ] "Join Without Swap" skips file operations entirely
- [ ] Correct error shown when folder not found
- [ ] Correct error shown when path is wrong or inaccessible
- [ ] Settings persist across restarts
- [ ] App works when FiveM is not running

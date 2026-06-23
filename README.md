<div align="center">
  <img src="src/assets/logo.svg" width="120" alt="Logo" />
  <h1>FiveM Cache Manager</h1>
  <p>
    <strong>A lightweight desktop app to seamlessly manage and swap your FiveM server caches.</strong>
  </p>
</div>

<br />

## 🌟 Overview

**FiveM Cache Manager** is a personal desktop application built with [Tauri v2](https://v2.tauri.app/). It embeds the official Cfx.re server list and automates the tedious process of swapping per-server cache folders before joining a game. 

When you frequently switch between different FiveM servers (like Roleplay servers), stale or mismatched cache data can cause extremely long loading times, texture glitches, or asset conflicts. Manually backing up and swapping `cache` folders before each session is frustrating. This app completely automates that workflow.

## 🚀 Key Features

- **Integrated Server Browser**: Browse `servers.fivem.net` directly inside the app without needing an external browser.
- **Smart Cache Swapping**: Click "Join" on any server, and the app will automatically detect the server name and swap your local cache folders (`cache`, `server-cache`, `server-cache-priv`).
- **Cache Preservation**: When swapping, the app safely moves your current active cache back to its previous storage folder so you never lose downloaded assets.
- **Fuzzy Matching**: Matches the server name dynamically with your local folders, handling special characters intelligently.
- **Lightweight & Fast**: Built with Rust and Vanilla JS on Tauri, resulting in a tiny memory footprint and native performance.

## 📁 Directory Convention

To use the Cache Manager effectively, your `FiveM.app/data` folder should be organized like this:

```text
FiveM\FiveM.app\data\
│
├── cache\                   ← active (swapped here before joining)
├── server-cache\            ← active
├── server-cache-priv\       ← active
│
├── My RP Server\            ← Folder name matches the Server Name
│   ├── cache\
│   ├── server-cache\
│   └── server-cache-priv\
│
└── Another Server\
    ├── cache\
    ├── server-cache\
    └── server-cache-priv\
```

## 🛠️ How It Works

1. **Launch**: The app opens directly to the official FiveM server list.
2. **Intercept**: When you click "Connect" on a server, a content script intercepts the action and passes the server name to the Rust backend.
3. **Swap**: The Rust backend searches for a matching folder in your `FiveM.app\data` directory. If found, it swaps the cache files instantly.
4. **Join**: Once the cache is swapped, the app launches the `fivem://connect/...` URL to start your game with the correct pre-loaded cache!

## ⚙️ Configuration & Settings

Settings are accessible via the **Gear Icon** in the bottom Action Bar.
- **FiveM Data Path**: Configure the absolute path to your `FiveM.app\data` directory (Default: `%LOCALAPPDATA%\FiveM\FiveM.app\data`).
- **Auto-Detect**: Automatically extract server names from the WebView.
- **Restore Previous Cache**: Ensures your last used cache is safely moved back to its respective folder before a new one is swapped in.

## 💻 Technical Stack

- **Framework**: Tauri v2
- **Backend**: Rust
- **Frontend**: Vanilla HTML / CSS / JavaScript
- **Web Engine**: WebView2 (Windows built-in)
- **CI/CD**: GitHub Actions (Automated Releases)

## 📦 Building from Source

Ensure you have [Node.js](https://nodejs.org/) and [Rust](https://rustup.rs/) installed.

```bash
# Clone the repository
git clone https://github.com/eznxxy/fivem-cache-manager.git

# Navigate into the project
cd fivem-cache-manager

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

---
*Disclaimer: This is a personal project and is not affiliated with, maintained, authorized, endorsed, or sponsored by Cfx.re or Rockstar Games.*

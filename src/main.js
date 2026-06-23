/**
 * FiveM Cache Manager — main.js
 * Dev-mode shell UI. Production loads servers.fivem.net directly;
 * the action bar is injected via content_script.js (Option B).
 */

// ── Tauri API (available via withGlobalTauri: true) ──
const { invoke } = window.__TAURI__?.core ?? {};

// ── DOM References ──
const dom = {
  statusDot:        document.getElementById('status-dot'),
  statusLabel:      document.getElementById('status-label'),
  statusSub:        document.getElementById('status-sub'),
  btnSwapJoin:      document.getElementById('btn-swap-join'),
  btnJoinNoSwap:    document.getElementById('btn-join-no-swap'),
  btnSettings:      document.getElementById('btn-settings'),
  btnSettingsClose: document.getElementById('btn-settings-close'),
  settingsPanel:    document.getElementById('settings-panel'),
  inputFivemPath:   document.getElementById('input-fivem-path'),
  btnBrowsePath:    document.getElementById('btn-browse-path'),
  toggleAutoDetect: document.getElementById('toggle-auto-detect'),
  toggleRestore:    document.getElementById('toggle-restore-cache'),
  folderList:       document.getElementById('folder-list'),
  btnRefreshFolders:document.getElementById('btn-refresh-folders'),
  btnSaveSettings:  document.getElementById('btn-save-settings'),
  saveStatus:       document.getElementById('save-status'),
  pathMsg:          document.getElementById('path-validation-msg'),
};

// ── App State ──
const state = {
  status: 'idle',        // idle | detected | swapping | done | error
  serverName: null,
  matchedFolder: null,
  joinUrl: null,
  settingsOpen: false,
  config: {
    fivemDataPath: '',
    autoDetectServer: true,
    restorePreviousCache: true,
    lastUsedFolder: null,
  },
};

// ── Status Messages ──
const STATUS_MESSAGES = {
  idle:     { label: 'Idle',     sub: 'Select a server from the browser above' },
  detected: { label: 'Server detected', sub: '' },
  swapping: { label: 'Swapping cache…', sub: 'Please wait, moving files…' },
  done:     { label: '✓ Cache ready',  sub: 'FiveM is launching…' },
  error:    { label: 'Error',    sub: '' },
};

// ── UI Updater ──
function setStatus(status, { sub = null, label = null } = {}) {
  state.status = status;

  const msg = STATUS_MESSAGES[status] ?? STATUS_MESSAGES.idle;
  dom.statusDot.dataset.status = status;
  dom.statusLabel.textContent  = label ?? msg.label;
  dom.statusSub.textContent    = sub   ?? msg.sub;

  // Button visibility
  const hasServer = !!state.joinUrl;
  dom.btnSwapJoin.disabled   = !hasServer || status === 'swapping';
  dom.btnJoinNoSwap.disabled = !hasServer || status === 'swapping';
}

function showSpinner(button) {
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.id = 'btn-spinner';
  button.prepend(spinner);
}

function removeSpinner() {
  document.getElementById('btn-spinner')?.remove();
}

// ── Settings Panel ──
function openSettings() {
  state.settingsOpen = true;
  dom.settingsPanel.classList.add('open');
  dom.settingsPanel.setAttribute('aria-hidden', 'false');
  dom.btnSettings.setAttribute('aria-expanded', 'true');
  loadConfigToUI();
  if (invoke) refreshFolderList();
}

function closeSettings() {
  state.settingsOpen = false;
  dom.settingsPanel.classList.remove('open');
  dom.settingsPanel.setAttribute('aria-hidden', 'true');
  dom.btnSettings.setAttribute('aria-expanded', 'false');
}

// ── Load config into settings UI ──
function loadConfigToUI() {
  dom.inputFivemPath.value          = state.config.fivemDataPath;
  dom.toggleAutoDetect.checked      = state.config.autoDetectServer;
  dom.toggleRestore.checked         = state.config.restorePreviousCache;
}

// ── Folder List ──
function renderFolderList(folders) {
  dom.folderList.innerHTML = '';
  if (!folders || folders.length === 0) {
    const li = document.createElement('li');
    li.className = 'folder-list-empty';
    li.textContent = 'No server folders detected';
    dom.folderList.appendChild(li);
    return;
  }
  folders.forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    dom.folderList.appendChild(li);
  });
}

async function refreshFolderList() {
  dom.btnRefreshFolders.disabled = true;
  try {
    if (invoke) {
      const folders = await invoke('get_server_folders');
      renderFolderList(folders);
    } else {
      // Dev mode placeholder
      renderFolderList(['Example Server', 'My RP Server']);
    }
  } catch (e) {
    renderFolderList([]);
    console.error('get_server_folders error:', e);
  } finally {
    dom.btnRefreshFolders.disabled = false;
  }
}

// ── Save Settings ──
async function saveSettings() {
  const path = dom.inputFivemPath.value.trim();
  state.config.fivemDataPath          = path;
  state.config.autoDetectServer       = dom.toggleAutoDetect.checked;
  state.config.restorePreviousCache   = dom.toggleRestore.checked;

  if (invoke) {
    try {
      const configToSave = {
        fivem_data_path: state.config.fivemDataPath,
        auto_detect_server: state.config.autoDetectServer,
        restore_previous_cache: state.config.restorePreviousCache,
        last_used_folder: state.config.lastUsedFolder,
      };
      await invoke('save_config', { config: configToSave });
    } catch (e) {
      console.error('save_config error:', e);
    }
  }

  // Show save feedback
  dom.saveStatus.textContent = '✓ Saved';
  dom.saveStatus.classList.add('visible');
  setTimeout(() => dom.saveStatus.classList.remove('visible'), 2500);
}

// ── Load Config on startup ──
async function loadConfig() {
  if (!invoke) {
    // Dev mode defaults
    state.config.fivemDataPath = '%LOCALAPPDATA%\\FiveM\\FiveM.app\\data';
    return;
  }
  try {
    const cfg = await invoke('load_config');
    if (cfg) {
      state.config.fivemDataPath        = cfg.fivem_data_path       ?? '';
      state.config.autoDetectServer     = cfg.auto_detect_server     ?? true;
      state.config.restorePreviousCache = cfg.restore_previous_cache ?? true;
      state.config.lastUsedFolder       = cfg.last_used_folder       ?? null;
    }
  } catch (e) {
    console.warn('Could not load config, using defaults:', e);
  }
}

// ── IPC: server_selected ──
// Called from the Rust backend after the content script invokes 'server_selected'.
// The content script calls Tauri invoke() directly — Rust receives it, logs it,
// and the UI is updated here by Tauri's event system OR by the content script
// calling window.__cacheManager directly (since initialization_script shares the same JS context).

window.__cacheManager = {
  /**
   * Called when user clicks Join/Connect on a server card.
   * @param {string} serverName - The server's display name
   * @param {string} joinUrl    - The fivem:// connect URL
   */
  onServerSelected(serverName, joinUrl) {
    state.serverName    = serverName?.trim() || 'Unknown Server';
    state.joinUrl       = joinUrl?.trim() || null;
    state.matchedFolder = null;

    const displayUrl = state.joinUrl
      ? state.joinUrl.replace('fivem://connect/', '')
      : 'URL unavailable';

    setStatus('detected', {
      label: `🎮 ${state.serverName}`,
      sub: `Connect: ${displayUrl}`,
    });

    console.log('[CacheManager] Server detected:', state.serverName, '→', state.joinUrl);
  },
};

// ── Also expose as global for content script to call directly ──
// The initialization_script runs in the same WebView context as servers.fivem.net,
// NOT in our main.js context. So content script uses Tauri invoke() to talk to Rust,
// and Rust forwards via emit() to our frontend. We wire that event here:
if (window.__TAURI__?.event) {
  window.__TAURI__.event.listen('server-detected', (event) => {
    const { serverName, joinUrl } = event.payload ?? {};
    if (serverName || joinUrl) {
      window.__cacheManager.onServerSelected(serverName, joinUrl);
    }
  }).catch(console.warn);
}

// ── Button: Swap & Join ──
dom.btnSwapJoin?.addEventListener('click', async () => {
  if (!state.joinUrl || !state.serverName) return;

  setStatus('swapping');
  showSpinner(dom.btnSwapJoin);

  try {
    let result = { success: true, matched_folder: null, message: 'Dev mode — no swap performed' };

    if (invoke) {
      result = await invoke('swap_cache', { serverName: state.serverName });
    }

    removeSpinner();

    if (result.success) {
      state.matchedFolder = result.matched_folder;
      setStatus('done', {
        sub: result.matched_folder
          ? `Matched: ${result.matched_folder}`
          : 'No cache folder matched — joined anyway',
      });
    } else {
      setStatus('error', { sub: result.message });
    }

    // Open FiveM join URL
    if (state.joinUrl) {
      if (invoke) {
        try {
          await invoke('openserver', { url: state.joinUrl });
        } catch (e) {
          console.error('[CacheManager] openserver failed:', e);
          const { open } = window.__TAURI__?.opener ?? {};
          if (open) await open(state.joinUrl);
        }
      } else {
        console.log('[Dev] Would open:', state.joinUrl);
      }
    }
  } catch (e) {
    removeSpinner();
    setStatus('error', { sub: String(e) });
  }
});

// ── Button: Join Without Swap ──
dom.btnJoinNoSwap?.addEventListener('click', async () => {
  if (!state.joinUrl) return;

  const confirmed = window.confirm(`Join without swapping cache?\n\n${state.serverName ?? 'Unknown server'}`);
  if (!confirmed) return;

  if (invoke) {
    try {
      await invoke('openserver', { url: state.joinUrl });
    } catch (e) {
      console.error('[CacheManager] openserver failed:', e);
      const { open } = window.__TAURI__?.opener ?? {};
      if (open) await open(state.joinUrl);
    }
  } else {
    console.log('[Dev] Would open (no swap):', state.joinUrl);
  }
});

// ── Settings Panel toggles ──
dom.btnSettings?.addEventListener('click', () => {
  if (state.settingsOpen) closeSettings();
  else openSettings();
});

dom.btnSettingsClose?.addEventListener('click', closeSettings);

// ── Settings: Browse path ──
dom.btnBrowsePath?.addEventListener('click', async () => {
  if (invoke) {
    try {
      const { open: openDialog } = window.__TAURI__?.dialog ?? {};
      if (openDialog) {
        const selected = await openDialog({ directory: true, title: 'Select FiveM data directory' });
        if (selected) dom.inputFivemPath.value = selected;
      }
    } catch (e) {
      console.error('dialog error:', e);
    }
  }
});

// ── Settings: Toggle changes auto-save ──
dom.toggleAutoDetect?.addEventListener('change', () => {
  state.config.autoDetectServer = dom.toggleAutoDetect.checked;
});
dom.toggleRestore?.addEventListener('change', () => {
  state.config.restorePreviousCache = dom.toggleRestore.checked;
});

// ── Settings: Save button ──
dom.btnSaveSettings?.addEventListener('click', saveSettings);

// ── Settings: Refresh folders ──
dom.btnRefreshFolders?.addEventListener('click', refreshFolderList);

// ── Init ──
async function init() {
  await loadConfig();
  setStatus('idle');
  console.log('[FiveM Cache Manager] v0.1.0 — Phase 2 ready');
}

init();

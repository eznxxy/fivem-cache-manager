/**
 * FiveM Cache Manager — Content Script + Injected Action Bar (Option B)
 * Injected into every page load in the WebView via Tauri initialization_script.
 *
 * 1. Inject fixed action bar at bottom of FiveM page
 * 2. Intercept Join/Connect clicks on server cards
 * 3. Extract server name + fivem:// join URL
 * 4. Update action bar + invoke Rust server_selected
 */

(function () {
  'use strict';

  const BAR_HEIGHT = 56;
  const HOME_URL = 'https://servers.fivem.net/';

  // ---------------------------------------------------------------------------
  // Search Box Auto-Clear on Startup
  // ---------------------------------------------------------------------------
  // Execute immediately before React hydrates to clear saved search filters
  (function clearSearchOnStartup() {
    if (sessionStorage.getItem('fcm_search_cleared')) return;
    
    try {
      localStorage.removeItem('sfilters:browse');
    } catch (e) {
      console.warn('[CacheManager] Failed to clear search localStorage:', e);
    }
    
    sessionStorage.setItem('fcm_search_cleared', 'true');
  })();

  // ── Guard: only run on fivem.net / cfx.re ──
  const host = window.location.hostname;
  if (!host.endsWith('fivem.net') && !host.endsWith('cfx.re')) return;

  // ── App state ──
  const state = {
    status: 'idle',
    serverName: null,
    joinUrl: null,
    matchedFolder: null,
  };

  // ── Tauri IPC ──
  function tauriInvoke(cmd, args) {
    try {
      if (window.__TAURI__?.core?.invoke) {
        return window.__TAURI__.core.invoke(cmd, args);
      }
      if (window.__TAURI_INTERNALS__?.invoke) {
        return window.__TAURI_INTERNALS__.invoke(cmd, args);
      }
      console.warn('[CacheManager] Tauri invoke not available');
      return Promise.resolve(null);
    } catch (e) {
      console.error('[CacheManager] invoke error:', e);
      return Promise.reject(e);
    }
  }

  async function openUrl(url) {
    try {
      await tauriInvoke('openserver', { url });
    } catch (e) {
      console.error('[CacheManager] openserver failed:', e);
      // Fallback
      if (window.__TAURI__?.opener?.open) {
        await window.__TAURI__.opener.open(url);
      } else {
        window.location.href = url;
      }
    }
  }

  // ── Action Bar CSS (scoped fcm-* prefix) ──
  const BAR_CSS = `
    #fcm-action-bar {
      --fcm-bg: #13161e;
      --fcm-bg-hover: #1f2435;
      --fcm-accent: #5d7bf5;
      --fcm-accent-bright: #7b96ff;
      --fcm-accent-glow: rgba(93, 123, 245, 0.35);
      --fcm-success: #3ecf8e;
      --fcm-warning: #f5a623;
      --fcm-danger: #f45b5b;
      --fcm-text: #e8eaf0;
      --fcm-text-muted: #8b91a8;
      --fcm-border: rgba(255, 255, 255, 0.07);
      --fcm-font: 'Inter', system-ui, -apple-system, sans-serif;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: ${BAR_HEIGHT}px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      background: var(--fcm-bg);
      border-top: 0.5px solid var(--fcm-border);
      font-family: var(--fcm-font);
      font-size: 14px;
      color: var(--fcm-text);
      z-index: 2147483646;
      box-sizing: border-box;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    #fcm-action-bar * { box-sizing: border-box; }
    #fcm-action-bar::before {
      content: '';
      position: absolute;
      top: -1px;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--fcm-accent) 30%, var(--fcm-accent-bright) 50%, var(--fcm-accent) 70%, transparent);
      opacity: 0.4;
      pointer-events: none;
    }
    #fcm-action-bar .fcm-status {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }
    #fcm-action-bar .fcm-dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      flex-shrink: 0;
      background: #4e5470;
    }
    #fcm-action-bar .fcm-dot[data-status="detected"] { background: var(--fcm-accent); box-shadow: 0 0 8px var(--fcm-accent-glow); }
    #fcm-action-bar .fcm-dot[data-status="swapping"] { background: var(--fcm-warning); animation: fcm-blink 1s ease-in-out infinite; }
    #fcm-action-bar .fcm-dot[data-status="done"] { background: var(--fcm-success); }
    #fcm-action-bar .fcm-dot[data-status="error"] { background: var(--fcm-danger); }
    @keyframes fcm-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    #fcm-action-bar .fcm-text-group {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 1px;
    }
    #fcm-action-bar .fcm-label {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }
    #fcm-action-bar .fcm-sub {
      font-size: 11px;
      color: var(--fcm-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
    }
    #fcm-action-bar .fcm-sub.fcm-error { color: var(--fcm-danger); }
    #fcm-action-bar .fcm-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    #fcm-action-bar .fcm-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: 1px solid transparent;
      border-radius: 10px;
      font-family: var(--fcm-font);
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      cursor: pointer;
      white-space: nowrap;
      background: transparent;
      color: var(--fcm-text-muted);
      transition: background 120ms ease, color 120ms ease;
    }
    #fcm-action-bar .fcm-btn:hover:not(:disabled) { background: var(--fcm-bg-hover); color: var(--fcm-text); }
    #fcm-action-bar .fcm-btn:disabled { opacity: 0.35; cursor: not-allowed; pointer-events: none; }
    #fcm-action-bar .fcm-btn-primary {
      background: var(--fcm-accent);
      color: #fff;
      border-color: var(--fcm-accent);
    }
    #fcm-action-bar .fcm-btn-primary:hover:not(:disabled) {
      background: var(--fcm-accent-bright);
      border-color: var(--fcm-accent-bright);
    }
    #fcm-action-bar .fcm-hidden { display: none !important; }
    #fcm-action-bar .fcm-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--fcm-border);
      border-top-color: var(--fcm-accent);
      border-radius: 9999px;
      animation: fcm-spin 0.7s linear infinite;
    }
    @keyframes fcm-spin { to { transform: rotate(360deg); } }
    html.fcm-has-bar { scroll-padding-bottom: ${BAR_HEIGHT}px !important; }
    body.fcm-has-bar { padding-bottom: ${BAR_HEIGHT}px !important; }

    /* ── Settings Panel ── */
    #fcm-settings {
      position: fixed;
      bottom: ${BAR_HEIGHT}px;
      left: 0;
      right: 0;
      height: 400px;
      background: #1a1e2a;
      border-top: 1px solid rgba(255,255,255,0.07);
      z-index: 2147483645;
      display: flex;
      flex-direction: column;
      transform: translateY(100%);
      transition: transform 300ms cubic-bezier(0.4,0,0.2,1);
      font-family: var(--fcm-font);
      box-shadow: 0 -8px 32px rgba(0,0,0,0.6);
    }
    #fcm-settings.fcm-settings-open { transform: translateY(0); }
    #fcm-settings * { box-sizing: border-box; }
    .fcm-settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
    }
    .fcm-settings-title {
      font-size: 13px;
      font-weight: 600;
      color: #e8eaf0;
      letter-spacing: 0.01em;
    }
    .fcm-settings-close {
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: #8b91a8;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }
    .fcm-settings-close:hover { background: #1f2435; color: #e8eaf0; }
    .fcm-settings-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      scrollbar-width: thin;
      scrollbar-color: #4e5470 transparent;
    }
    .fcm-settings-body::-webkit-scrollbar { width: 4px; }
    .fcm-settings-body::-webkit-scrollbar-thumb { background: #4e5470; border-radius: 9999px; }
    .fcm-section-title {
      font-size: 10px;
      font-weight: 600;
      color: #4e5470;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }
    .fcm-input-row {
      display: flex;
      gap: 8px;
    }
    .fcm-text-input {
      flex: 1;
      background: #0d0f14;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
      padding: 7px 10px;
      color: #e8eaf0;
      font-family: 'Consolas', monospace;
      font-size: 11px;
      outline: none;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .fcm-text-input:focus {
      border-color: rgba(93,123,245,0.6);
      box-shadow: 0 0 0 3px rgba(93,123,245,0.18);
    }
    .fcm-hint {
      font-size: 10px;
      color: #4e5470;
      margin-top: 4px;
      min-height: 14px;
    }
    .fcm-hint.ok { color: #3ecf8e; }
    .fcm-hint.err { color: #f45b5b; }
    .fcm-toggle-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.07);
      background: #13161e;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .fcm-toggle-row:hover { background: #1f2435; border-color: rgba(255,255,255,0.12); }
    .fcm-toggle-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .fcm-toggle-label { font-size: 12px; font-weight: 500; color: #e8eaf0; }
    .fcm-toggle-desc { font-size: 10px; color: #8b91a8; line-height: 1.5; }
    .fcm-toggle-track {
      flex-shrink: 0;
      width: 38px; height: 22px;
      position: relative;
      margin-top: 2px;
    }
    .fcm-toggle-input {
      position: absolute; opacity: 0; width: 0; height: 0;
    }
    .fcm-toggle-thumb {
      position: absolute; inset: 0;
      background: #0d0f14;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 9999px;
      cursor: pointer;
      transition: background 200ms ease, border-color 200ms ease;
    }
    .fcm-toggle-thumb::after {
      content: '';
      position: absolute;
      width: 14px; height: 14px;
      border-radius: 9999px;
      background: #4e5470;
      top: 50%; left: 3px;
      transform: translateY(-50%);
      transition: transform 200ms ease, background 200ms ease;
    }
    .fcm-toggle-input:checked + .fcm-toggle-thumb { background: rgba(93,123,245,0.18); border-color: #5d7bf5; }
    .fcm-toggle-input:checked + .fcm-toggle-thumb::after { transform: translate(16px,-50%); background: #5d7bf5; }
    .fcm-section-row {
      display: flex; align-items: center; justify-content: space-between;
    }
    .fcm-folder-list {
      list-style: none;
      display: flex; flex-direction: column; gap: 4px;
      max-height: 100px;
      overflow-y: auto;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
      background: #0d0f14;
      padding: 8px;
      scrollbar-width: thin;
      scrollbar-color: #4e5470 transparent;
    }
    .fcm-folder-list li {
      padding: 3px 8px;
      font-size: 11px;
      font-family: 'Consolas', monospace;
      color: #8b91a8;
      display: flex; align-items: center; gap: 8px;
      border-radius: 4px;
    }
    .fcm-folder-list li::before {
      content: '';
      width: 5px; height: 5px;
      border-radius: 9999px;
      background: #5d7bf5;
      flex-shrink: 0;
    }
    .fcm-folder-empty { color: #4e5470 !important; font-style: italic; justify-content: center !important; }
    .fcm-folder-empty::before { display: none !important; }
    .fcm-settings-footer {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      border-top: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
    }
    .fcm-save-status {
      font-size: 11px;
      color: #3ecf8e;
      opacity: 0;
      transition: opacity 200ms ease;
    }
    .fcm-save-status.fcm-visible { opacity: 1; }
    /* Gear button in action bar */
    #fcm-btn-settings {
      margin-left: 4px;
      background: transparent;
      border: none;
      color: #8b91a8;
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      transition: background 120ms ease, color 120ms ease, transform 300ms ease;
    }
    #fcm-btn-settings:hover { background: #1f2435; color: #e8eaf0; }
    #fcm-btn-settings.fcm-settings-active { color: #5d7bf5; transform: rotate(45deg); }
    /* Modal styles */
    .fcm-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      z-index: 9999999;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none;
      transition: opacity 200ms ease;
    }
    .fcm-modal-overlay.fcm-visible {
      opacity: 1; pointer-events: auto;
    }
    .fcm-modal {
      background: #13161e;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      width: 320px;
      max-width: 90vw;
      box-shadow: 0 16px 32px rgba(0,0,0,0.4);
      transform: translateY(20px) scale(0.95);
      transition: transform 200ms ease;
      display: flex; flex-direction: column;
    }
    .fcm-modal-overlay.fcm-visible .fcm-modal {
      transform: translateY(0) scale(1);
    }
    .fcm-modal-header {
      padding: 16px 20px 12px;
      font-size: 16px; font-weight: 600; color: #f45b5b;
      display: flex; align-items: center; gap: 8px;
    }
    .fcm-modal-body {
      padding: 0 20px 16px;
      font-size: 13px; color: #8b91a8; line-height: 1.5;
    }
    .fcm-modal-footer {
      padding: 12px 20px;
      display: flex; justify-content: flex-end; gap: 12px;
      background: #0d0f14;
      border-top: 1px solid rgba(255,255,255,0.05);
      border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;
    }
    .fcm-modal .fcm-btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 500;
      cursor: pointer; border: 1px solid transparent; transition: all 150ms ease;
      background: #1f2435; color: #e8eaf0;
    }
    .fcm-modal .fcm-btn:hover { background: #2a3045; }
    .fcm-modal .fcm-btn-primary {
      background: #5d7bf5 !important; color: #fff !important; border-color: #5d7bf5 !important;
    }
    .fcm-modal .fcm-btn-primary:hover {
      background: #768ef6 !important; border-color: #768ef6 !important;
    }
    /* Pre-requisite indicators */
    .fcm-prereqs {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-left: 24px;
      padding-left: 24px;
      border-left: 1px solid rgba(255,255,255,0.07);
    }
    .fcm-prereq-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
      color: #f45b5b;
      transition: color 200ms ease;
    }
    .fcm-prereq-item.fcm-prereq-ok {
      color: #3ecf8e;
    }
    .fcm-prereq-icon {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
  `;

  // ── DOM refs (set after injection) ──
  let dom = {};

  function injectActionBar() {
    if (document.getElementById('fcm-action-bar')) return;

    const style = document.createElement('style');
    style.id = 'fcm-styles';
    style.textContent = BAR_CSS;
    document.head.appendChild(style);

    document.documentElement.classList.add('fcm-has-bar');
    if (document.body) document.body.classList.add('fcm-has-bar');

    const bar = document.createElement('footer');
    bar.id = 'fcm-action-bar';
    bar.setAttribute('role', 'complementary');
    bar.setAttribute('aria-label', 'Cache Manager Controls');
    bar.innerHTML = `
      <div class="fcm-status">
        <div class="fcm-dot" id="fcm-dot" data-status="idle"></div>
        <div class="fcm-text-group">
          <span class="fcm-label" id="fcm-label">Pilih server dari daftar di atas</span>
          <span class="fcm-sub" id="fcm-sub"></span>
        </div>
        <div class="fcm-prereqs" id="fcm-prereqs" title="Memuat status aplikasi...">
          <div class="fcm-prereq-item" id="fcm-prereq-steam" title="Steam tidak berjalan!">
            <svg class="fcm-prereq-icon" viewBox="0 0 24 24"><path d="M12.002 0C5.377 0 .002 5.375.002 12c0 4.965 3.011 9.231 7.379 11.002l3.413-4.931c-1.899-.545-3.327-2.302-3.327-4.402 0-2.485 2.015-4.502 4.502-4.502s4.502 2.017 4.502 4.502-2.015 4.502-4.502 4.502c-.371 0-.727-.052-1.071-.144l-3.364 4.86c2.096.721 4.382.724 6.477.017C19.986 21.037 24 16.98 24 12c0-6.625-5.373-12-11.998-12zm-3.834 16.593c-.927 0-1.677-.751-1.677-1.678 0-.926.75-1.676 1.677-1.676.925 0 1.676.75 1.676 1.676 0 .927-.751 1.678-1.676 1.678zm10.334-2.925c-.926 0-1.676-.75-1.676-1.676s.75-1.678 1.676-1.678 1.677.752 1.677 1.678-.751 1.676-1.677 1.676z"/></svg>
            Steam
          </div>
          <div class="fcm-prereq-item" id="fcm-prereq-discord" title="Discord tidak berjalan!">
            <svg class="fcm-prereq-icon" viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
            Discord
          </div>
        </div>
      </div>
      <div class="fcm-actions">
        <button type="button" class="fcm-btn fcm-hidden" id="fcm-btn-join-no-swap" disabled>
          Join Without Swap
        </button>
        <button type="button" class="fcm-btn fcm-btn-primary fcm-hidden" id="fcm-btn-swap-join" disabled>
          Swap &amp; Join
        </button>
        <button type="button" id="fcm-btn-settings" title="Settings" aria-label="Open settings">
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14.55 11.175a1.35 1.35 0 00.27 1.485l.049.049a1.638 1.638 0 010 2.317 1.637 1.637 0 01-2.317 0l-.049-.049a1.35 1.35 0 00-1.485-.27 1.35 1.35 0 00-.818 1.237v.138a1.638 1.638 0 01-3.275 0v-.073a1.35 1.35 0 00-.884-1.237 1.35 1.35 0 00-1.485.27l-.049.048a1.637 1.637 0 01-2.317-2.316l.049-.049a1.35 1.35 0 00.27-1.485 1.35 1.35 0 00-1.237-.818H.938a1.638 1.638 0 010-3.276h.073a1.35 1.35 0 001.237-.883 1.35 1.35 0 00-.27-1.485l-.049-.049A1.638 1.638 0 014.246 2.9l.049.049a1.35 1.35 0 001.485.27h.065A1.35 1.35 0 006.663 1.98V1.84a1.638 1.638 0 013.276 0v.073a1.35 1.35 0 00.818 1.237 1.35 1.35 0 001.485-.27l.049-.049a1.638 1.638 0 012.317 2.317l-.049.049a1.35 1.35 0 00-.27 1.485v.065a1.35 1.35 0 001.237.818h.138a1.638 1.638 0 010 3.276h-.073a1.35 1.35 0 00-1.237.818v-.001z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;
    
    // Inject modal HTML separately
    const modalHtml = `
      <div id="fcm-modal-overlay" class="fcm-modal-overlay">
        <div class="fcm-modal">
          <div class="fcm-modal-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            Peringatan Steam
          </div>
          <div class="fcm-modal-body">
            Aplikasi Steam terdeteksi belum berjalan. FiveM sangat membutuhkan Steam untuk proses autentikasi. Jika Anda melanjutkannya, Anda mungkin gagal terhubung ke server.
          </div>
          <div class="fcm-modal-footer">
            <button class="fcm-btn fcm-btn-secondary" id="fcm-modal-btn-cancel">Batal</button>
            <button class="fcm-btn fcm-btn-primary" id="fcm-modal-btn-continue" style="background:#f45b5b !important;border-color:#f45b5b !important;">Tetap Join</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(bar);
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    dom = {
      dot: bar.querySelector('#fcm-dot'),
      label: bar.querySelector('#fcm-label'),
      sub: bar.querySelector('#fcm-sub'),
      btnJoinNoSwap: bar.querySelector('#fcm-btn-join-no-swap'),
      btnSwapJoin: bar.querySelector('#fcm-btn-swap-join'),
      btnSettings: bar.querySelector('#fcm-btn-settings'),
      prereqSteam: bar.querySelector('#fcm-prereq-steam'),
      prereqDiscord: bar.querySelector('#fcm-prereq-discord'),
      prereqsContainer: bar.querySelector('#fcm-prereqs'),
      modalOverlay: document.getElementById('fcm-modal-overlay'),
      modalBtnCancel: document.getElementById('fcm-modal-btn-cancel'),
      modalBtnContinue: document.getElementById('fcm-modal-btn-continue'),
    };

    dom.btnSwapJoin.addEventListener('click', () => checkSteamBeforeJoin(handleSwapJoin));
    dom.btnJoinNoSwap.addEventListener('click', () => checkSteamBeforeJoin(handleJoinNoSwap));
    dom.btnSettings.addEventListener('click', toggleSettings);

    setBarStatus('idle');
    injectSettingsPanel();
    console.log('[CacheManager] Action bar injected');
  }

  function ensureBar() {
    if (!document.getElementById('fcm-action-bar')) injectActionBar();
  }

  function setBarStatus(status, opts = {}) {
    ensureBar();
    if (!dom.dot) return;

    state.status = status;
    const { label, sub, isError = false } = opts;

    const defaults = {
      idle:     { label: 'Pilih server dari daftar di atas', sub: '' },
      detected: { label: '', sub: '' },
      swapping: { label: 'Sedang memindahkan cache...', sub: 'Mohon tunggu' },
      done:     { label: '✓ Cache siap — FiveM sedang dibuka', sub: '' },
      error:    { label: 'Error', sub: '' },
    };

    const msg = defaults[status] ?? defaults.idle;

    dom.dot.dataset.status = status;
    dom.label.textContent = label ?? msg.label;
    dom.sub.textContent = sub ?? msg.sub;
    dom.sub.classList.toggle('fcm-error', isError || status === 'error');

    const hasServer = !!state.joinUrl;
    const isSwapping = status === 'swapping';

    dom.btnSwapJoin.classList.toggle('fcm-hidden', status === 'idle');
    dom.btnJoinNoSwap.classList.toggle('fcm-hidden', !hasServer || status === 'idle');

    dom.btnSwapJoin.disabled = !hasServer || isSwapping;
    dom.btnJoinNoSwap.disabled = !hasServer || isSwapping;
  }

  function isGenericServerName(text) {
    if (!text || text.length > 100) return true;
    const lower = text.toLowerCase().trim();
    return (
      lower.includes('cfx.re server list') ||
      lower.includes('server list') ||
      lower === 'servers' ||
      lower === 'connect' ||
      lower === 'fivem' ||
      lower === 'join' ||
      lower === 'details' ||
      lower === 'players' ||
      lower === 'about'
    );
  }

  /** Convert join code / cfx.re path to fivem:// URL */
  function toFivemConnectUrl(raw) {
    if (!raw) return null;
    const s = raw.trim();
    if (s.startsWith('fivem://')) return s;

    const cfxMatch = s.match(/cfx\.re\/join\/([a-zA-Z0-9]+)/i);
    if (cfxMatch) return `fivem://connect/${cfxMatch[1]}`;

    if (/^[a-zA-Z0-9]+$/.test(s)) return `fivem://connect/${s}`;

    if (/^[\w.-]+:\d+$/.test(s)) return `fivem://connect/${s}`;

    return null;
  }

  function extractJoinCodeFromPath() {
    const m = window.location.pathname.match(/\/servers\/detail\/([a-zA-Z0-9]+)/i);
    return m ? m[1] : null;
  }

  /** Find join URL from full page (detail view shows cfx.re/join/xxx, not fivem://) */
  function extractJoinUrlFromPage() {
    const fivemA = document.querySelector('a[href^="fivem://"]');
    if (fivemA?.href) return fivemA.href;

    const cfxAnchors = document.querySelectorAll(
      'a[href*="/join/"], a[href*="cfx.re/join"]'
    );
    for (const a of cfxAnchors) {
      const href = a.getAttribute('href') || a.href || '';
      const url = toFivemConnectUrl(href);
      if (url) return url;
    }

    const pathCode = extractJoinCodeFromPath();
    if (pathCode) return toFivemConnectUrl(pathCode);

    const bodyText = document.body?.innerText || '';
    const textMatch = bodyText.match(/cfx\.re\/join\/([a-zA-Z0-9]+)/i);
    if (textMatch) return toFivemConnectUrl(textMatch[1]);

    return null;
  }

  function extractPageServerName() {
    const candidates = document.querySelectorAll(
      'h1, h2, h3, h4, h5, .title, .name, [class*="title"], [class*="Title"], [class*="serverName"], [class*="server-name"], [class*="server_name"], [class*="name"], [class*="Name"], [class*="header"], [class*="Header"], strong, b, [class="o8\\+wG60S rTNUUpIs"]'
    );
    for (const el of candidates) {
      if (el.closest('#fcm-action-bar') || el.closest('#fcm-settings')) continue;
      
      const text = el.textContent?.trim();
      if (text && !isGenericServerName(text)) {
        return text.split('\n')[0].trim();
      }
    }
    
    if (document.title) {
      const parts = document.title.split(/[-|]/);
      if (parts.length > 0) {
        const t = parts[0].trim();
        if (t && !isGenericServerName(t)) return t;
      }
    }
    return null;
  }

  function onServerSelected(serverName, joinUrl) {
    ensureBar();
    state.serverName = (serverName?.trim() || 'Unknown Server');
    state.joinUrl = joinUrl?.trim() || null;
    state.matchedFolder = null;

    const displayUrl = state.joinUrl
      ? state.joinUrl.replace('fivem://connect/', '')
      : 'URL tidak tersedia';

    setBarStatus('detected', {
      label: `Ditemukan: ${state.serverName}`,
      sub: state.joinUrl ? `Connect: ${displayUrl}` : 'Join URL tidak ditemukan',
      isError: !state.joinUrl,
    });

    console.log('[CacheManager] Server detected:', state.serverName, '→', state.joinUrl);
  }

  function resetBar() {
    state.serverName = null;
    state.joinUrl = null;
    state.matchedFolder = null;
    setBarStatus('idle');
  }

  // ── Settings State ──
  const settingsState = {
    open: false,
    config: {
      fivem_data_path: '',
      auto_detect_server: true,
      restore_previous_cache: true,
      last_used_folder: null,
    },
  };

  let settingsDom = {};

  function injectSettingsPanel() {
    if (document.getElementById('fcm-settings')) return;

    const panel = document.createElement('aside');
    panel.id = 'fcm-settings';
    panel.setAttribute('aria-label', 'Cache Manager Settings');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
      <div class="fcm-settings-header">
        <span class="fcm-settings-title">⚙ Cache Manager Settings</span>
        <button type="button" class="fcm-settings-close" id="fcm-settings-close" title="Close settings">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="fcm-settings-body">

        <section>
          <div class="fcm-section-title">FiveM Data Directory</div>
          <div class="fcm-input-row">
            <input type="text" id="fcm-path-input" class="fcm-text-input"
              placeholder="FiveM/FiveM.app/data"
              aria-label="FiveM data directory path" />
            <button type="button" class="fcm-btn fcm-btn-secondary" id="fcm-browse-btn"
              style="border:1px solid rgba(255,255,255,0.12);background:transparent;color:#e8eaf0;">
              Browse
            </button>
          </div>
          <p class="fcm-hint" id="fcm-path-hint"></p>
        </section>

        <section>
          <div class="fcm-section-title">Behavior</div>
          <label class="fcm-toggle-row" for="fcm-toggle-auto">
            <div class="fcm-toggle-info">
              <span class="fcm-toggle-label">Auto-detect server name</span>
              <span class="fcm-toggle-desc">Extract server name from clicked card automatically</span>
            </div>
            <div class="fcm-toggle-track">
              <input type="checkbox" class="fcm-toggle-input" id="fcm-toggle-auto" checked />
              <span class="fcm-toggle-thumb" aria-hidden="true"></span>
            </div>
          </label>
          <label class="fcm-toggle-row" for="fcm-toggle-restore" style="margin-top:8px">
            <div class="fcm-toggle-info">
              <span class="fcm-toggle-label">Restore previous cache before swap</span>
              <span class="fcm-toggle-desc">Move root cache back to its folder before swapping in the new one</span>
            </div>
            <div class="fcm-toggle-track">
              <input type="checkbox" class="fcm-toggle-input" id="fcm-toggle-restore" checked />
              <span class="fcm-toggle-thumb" aria-hidden="true"></span>
            </div>
          </label>
        </section>

        <section>
          <div class="fcm-section-row">
            <div class="fcm-section-title" style="margin-bottom:0">Detected Server Folders</div>
            <button type="button" class="fcm-btn" id="fcm-refresh-folders"
              style="font-size:10px;padding:4px 8px;background:transparent;border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#8b91a8;cursor:pointer;">
              ↻ Refresh
            </button>
          </div>
          <ul class="fcm-folder-list" id="fcm-folder-list" style="margin-top:8px">
            <li class="fcm-folder-empty">Loading...</li>
          </ul>
        </section>

      </div>
      <div class="fcm-settings-footer">
        <button type="button" class="fcm-btn fcm-btn-primary" id="fcm-save-settings"
          style="background:#5d7bf5;color:#fff;border:1px solid #5d7bf5;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;">
          Save Settings
        </button>
        <span class="fcm-save-status" id="fcm-save-status"></span>
      </div>
    `;

    document.body.appendChild(panel);

    settingsDom = {
      panel,
      closeBtn: panel.querySelector('#fcm-settings-close'),
      pathInput: panel.querySelector('#fcm-path-input'),
      browseBtn: panel.querySelector('#fcm-browse-btn'),
      pathHint: panel.querySelector('#fcm-path-hint'),
      toggleAuto: panel.querySelector('#fcm-toggle-auto'),
      toggleRestore: panel.querySelector('#fcm-toggle-restore'),
      folderList: panel.querySelector('#fcm-folder-list'),
      refreshBtn: panel.querySelector('#fcm-refresh-folders'),
      saveBtn: panel.querySelector('#fcm-save-settings'),
      saveStatus: panel.querySelector('#fcm-save-status'),
    };

    settingsDom.closeBtn.addEventListener('click', closeSettings);
    settingsDom.browseBtn.addEventListener('click', browseFolder);
    settingsDom.refreshBtn.addEventListener('click', refreshFolderList);
    settingsDom.saveBtn.addEventListener('click', saveSettings);
    settingsDom.toggleAuto.addEventListener('change', onToggleChange);
    settingsDom.toggleRestore.addEventListener('change', onToggleChange);
    settingsDom.pathInput.addEventListener('input', validatePath);

    loadConfig();
  }

  function openSettings() {
    settingsState.open = true;
    settingsDom.panel?.classList.add('fcm-settings-open');
    settingsDom.panel?.setAttribute('aria-hidden', 'false');
    dom.btnSettings?.classList.add('fcm-settings-active');
    loadConfigToUI();
    refreshFolderList();
  }

  function closeSettings() {
    settingsState.open = false;
    settingsDom.panel?.classList.remove('fcm-settings-open');
    settingsDom.panel?.setAttribute('aria-hidden', 'true');
    dom.btnSettings?.classList.remove('fcm-settings-active');
  }

  function toggleSettings() {
    if (settingsState.open) closeSettings();
    else openSettings();
  }

  function loadConfigToUI() {
    if (settingsDom.pathInput) settingsDom.pathInput.value = settingsState.config.fivem_data_path || '';
    if (settingsDom.toggleAuto) settingsDom.toggleAuto.checked = settingsState.config.auto_detect_server;
    if (settingsDom.toggleRestore) settingsDom.toggleRestore.checked = settingsState.config.restore_previous_cache;
  }

  async function loadConfig() {
    try {
      const cfg = await tauriInvoke('loadconfig');
      if (cfg) {
        settingsState.config = {
          fivem_data_path: cfg.fivem_data_path || '',
          auto_detect_server: cfg.auto_detect_server ?? true,
          restore_previous_cache: cfg.restore_previous_cache ?? true,
          last_used_folder: cfg.last_used_folder ?? null,
        };
        loadConfigToUI();
      }
    } catch (e) {
      console.warn('[CacheManager] loadConfig failed:', e);
    }
  }

  function validatePath() {
    if (!settingsDom.pathHint) return;
    const val = settingsDom.pathInput?.value?.trim() || '';
    if (!val) {
      settingsDom.pathHint.textContent = '';
      settingsDom.pathHint.className = 'fcm-hint';
    } else {
      settingsDom.pathHint.textContent = 'Path akan divalidasi saat disimpan';
      settingsDom.pathHint.className = 'fcm-hint';
    }
  }

  async function browseFolder() {
    try {
      const openDialog = window.__TAURI__?.dialog?.open;
      if (openDialog) {
        const selected = await openDialog({ directory: true, title: 'Pilih folder data FiveM' });
        if (selected && settingsDom.pathInput) {
          settingsDom.pathInput.value = selected;
          validatePath();
        }
      } else {
        console.warn('[CacheManager] dialog.open not available');
      }
    } catch (e) {
      console.error('[CacheManager] browseFolder error:', e);
    }
  }

  function onToggleChange() {
    // Auto-save toggles immediately
    settingsState.config.auto_detect_server = settingsDom.toggleAuto?.checked ?? true;
    settingsState.config.restore_previous_cache = settingsDom.toggleRestore?.checked ?? true;
    tauriInvoke('saveconfig', { config: settingsState.config }).catch(e =>
      console.warn('[CacheManager] auto-save toggle failed:', e)
    );
  }

  async function saveSettings() {
    const path = settingsDom.pathInput?.value?.trim() || '';
    settingsState.config.fivem_data_path = path;
    settingsState.config.auto_detect_server = settingsDom.toggleAuto?.checked ?? true;
    settingsState.config.restore_previous_cache = settingsDom.toggleRestore?.checked ?? true;

    try {
      await tauriInvoke('saveconfig', { config: settingsState.config });
      if (settingsDom.pathHint) {
        settingsDom.pathHint.textContent = '✓ Path tersimpan';
        settingsDom.pathHint.className = 'fcm-hint ok';
      }
      if (settingsDom.saveStatus) {
        settingsDom.saveStatus.textContent = '✓ Tersimpan';
        settingsDom.saveStatus.classList.add('fcm-visible');
        setTimeout(() => settingsDom.saveStatus.classList.remove('fcm-visible'), 2500);
      }
      // Refresh folder list setelah save (path mungkin berubah)
      refreshFolderList();
    } catch (e) {
      if (settingsDom.pathHint) {
        settingsDom.pathHint.textContent = `Error: ${e}`;
        settingsDom.pathHint.className = 'fcm-hint err';
      }
    }
  }

  async function refreshFolderList() {
    if (!settingsDom.folderList) return;
    settingsDom.refreshBtn && (settingsDom.refreshBtn.disabled = true);
    settingsDom.folderList.innerHTML = '<li class="fcm-folder-empty">Memuat...</li>';
    try {
      const folders = await tauriInvoke('getserverfolders');
      settingsDom.folderList.innerHTML = '';
      if (!folders || folders.length === 0) {
        const li = document.createElement('li');
        li.className = 'fcm-folder-empty';
        li.textContent = 'Tidak ada folder server terdeteksi';
        settingsDom.folderList.appendChild(li);
      } else {
        folders.forEach(name => {
          const li = document.createElement('li');
          li.textContent = name;
          settingsDom.folderList.appendChild(li);
        });
      }
    } catch (e) {
      settingsDom.folderList.innerHTML = `<li class="fcm-folder-empty">Error: ${e}</li>`;
    } finally {
      settingsDom.refreshBtn && (settingsDom.refreshBtn.disabled = false);
    }
  }

  async function handleSwapJoin() {
    if (!state.joinUrl || !state.serverName) return;

    setBarStatus('swapping');
    const spinner = document.createElement('span');
    spinner.className = 'fcm-spinner';
    dom.btnSwapJoin.prepend(spinner);

    try {
      const result = await tauriInvoke('swapcache', { serverName: state.serverName });
      spinner.remove();

      if (result?.success) {
        state.matchedFolder = result.matched_folder;
        const folderInfo = result.matched_folder
          ? `folder: ${result.matched_folder}`
          : 'tidak ada folder yang cocok';
        setBarStatus('done', { sub: folderInfo });
      } else {
        setBarStatus('error', {
          sub: result?.message || 'Swap gagal',
          isError: true,
        });
      }

      if (state.joinUrl) await openUrl(state.joinUrl);
    } catch (e) {
      spinner.remove();
      setBarStatus('error', { sub: String(e), isError: true });
    }
  }

  async function handleJoinNoSwap() {
    if (!state.joinUrl) return;
    const confirmed = window.confirm(
      `Join tanpa swap cache?\n\n${state.serverName ?? 'Unknown server'}`
    );
    if (!confirmed) return;
    await openUrl(state.joinUrl);
  }

  // ── DOM Helpers ──

  function queryFirst(root, selectors) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) { /* ignore invalid selector */ }
    }
    return null;
  }

  function findServerCard(element) {
    let node = element;
    const maxDepth = 12;
    let depth = 0;
    while (node && depth < maxDepth) {
      if (
        node.dataset?.serverId ||
        node.classList?.contains('server-item') ||
        node.classList?.contains('server-card') ||
        node.classList?.contains('list-item') ||
        node.getAttribute?.('role') === 'listitem' ||
        node.tagName === 'LI' ||
        node.tagName === 'ARTICLE'
      ) {
        return node;
      }
      node = node.parentElement;
      depth++;
    }
    node = element;
    for (let i = 0; i < 6; i++) {
      if (node.parentElement) node = node.parentElement;
    }
    return node;
  }

  function extractServerName(card) {
    if (card.dataset?.serverName) return card.dataset.serverName.trim();

    const nameEl = queryFirst(card, [
      'h1', 'h2', 'h3', 'h4',
      '[class*="server-name"]',
      '[class*="serverName"]',
      '[class*="server_name"]',
    ]);
    if (nameEl?.textContent?.trim() && !isGenericServerName(nameEl.textContent.trim())) {
      return nameEl.textContent.trim();
    }

    if (card.getAttribute?.('aria-label')) {
      const aria = card.getAttribute('aria-label').trim();
      if (!isGenericServerName(aria)) return aria;
    }

    const titled = card.querySelector('[title]');
    if (titled?.title && !isGenericServerName(titled.title.trim())) {
      return titled.title.trim();
    }

    return null;
  }

  function extractJoinUrl(card, clickedEl) {
    if (clickedEl.tagName === 'A' && clickedEl.href?.startsWith('fivem://')) {
      return clickedEl.href;
    }

    const fivemLink = card.querySelector('a[href^="fivem://"]');
    if (fivemLink?.href) return fivemLink.href;

    const cfxLinks = card.querySelectorAll('a[href*="/join/"], a[href*="cfx.re/join"]');
    for (const link of cfxLinks) {
      const href = link.getAttribute('href') || link.href || '';
      const url = toFivemConnectUrl(href);
      if (url) return url;
    }

    if (card.dataset?.joinUrl) return toFivemConnectUrl(card.dataset.joinUrl);
    if (card.dataset?.connectUrl) return toFivemConnectUrl(card.dataset.connectUrl);

    const addrEl = queryFirst(card, [
      '[class*="address"]',
      '[class*="ip"]',
    ]);
    if (addrEl?.textContent?.trim()) {
      const addr = addrEl.textContent.trim();
      const url = toFivemConnectUrl(addr);
      if (url) return url;
    }

    const links = card.querySelectorAll('a[href]');
    for (const link of links) {
      if (link.href?.startsWith('fivem://')) return link.href;
      const href = link.getAttribute('href') || '';
      const url = toFivemConnectUrl(href);
      if (url) return url;
    }

  // Fallback: scan full page (detail view join URL is outside card)
    return extractJoinUrlFromPage();
  }

  function isJoinElement(el) {
    if (!el) return false;

    const href = el.getAttribute('href') ?? '';
    const text = (el.textContent ?? '').trim().toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') ?? '').toLowerCase();

    if (href.startsWith('fivem://')) return true;
    if (href.includes('/join/') || href.includes('cfx.re/join')) return true;

    // Match button/link label exactly — avoid class*="connect" false positives
    if (text === 'connect' || text === 'join' || text === 'play') return true;
    if (ariaLabel === 'connect' || ariaLabel === 'join') return true;

    return false;
  }

  function processJoin(serverName, joinUrl) {
    const url = (joinUrl?.trim() || extractJoinUrlFromPage() || '').trim();
    const name = (serverName?.trim() || extractPageServerName() || 'Unknown Server');

    if (!url) {
      console.error('[CacheManager] Could not extract join URL');
      return false;
    }
    if (!serverName && !extractPageServerName()) {
      console.error('[CacheManager] Could not extract server name');
    }

    console.log('[CacheManager] Join intercepted:', { serverName: name, joinUrl: url });

    onServerSelected(name, url);
    tauriInvoke('serverselected', { serverName: name, joinUrl: url });
    return true;
  }

  /** Only intercept fivem:// anchors early — other Connect buttons may use JS navigation */
  function handleJoinPointerDown(e) {
    if (e.target.closest('#fcm-action-bar')) return;

    const fivemAnchor = e.target.closest('a[href^="fivem://"]');
    if (!fivemAnchor) return;

    e.preventDefault();
    e.stopPropagation();
    const card = findServerCard(fivemAnchor);
    const serverName = extractServerName(card) || extractPageServerName();
    processJoin(serverName, fivemAnchor.href);
  }

  function handleJoinClick(e) {
    if (e.target.closest('#fcm-action-bar')) return;

    const fivemAnchor = e.target.closest('a[href^="fivem://"]');
    if (fivemAnchor) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const target = e.target.closest('a, button, [role="button"]');
    if (!target || !isJoinElement(target)) return;

    const card = findServerCard(target);
    const joinUrl = extractJoinUrl(card, target);

    // No URL found — let Connect trigger fivem:// nav; Rust fallback will handle it
    if (!joinUrl) return;

    e.preventDefault();
    e.stopPropagation();

    const serverName = extractServerName(card) || extractPageServerName();
    processJoin(serverName, joinUrl);
  }

  // ── Navigation guard: reset bar when leaving cfx.re ecosystem ──
  function isAllowedHost(hostname) {
    return hostname.endsWith('fivem.net') || hostname.endsWith('cfx.re');
  }

  function checkNavigationReset() {
    if (!isAllowedHost(window.location.hostname)) {
      resetBar();
    }
  }

  // ── Globals for Rust webview.eval() ──
  window.__fcmOnServerSelected = function (serverName, joinUrl) {
    onServerSelected(serverName, joinUrl);
  };

  window.__fcmHandleFallbackJoin = function (joinUrl) {
    const serverName = extractPageServerName();
    const url = toFivemConnectUrl(joinUrl) || joinUrl;
    
    if (!serverName) {
      setTimeout(() => {
        const delayedName = extractPageServerName();
        processJoin(delayedName, url);
      }, 500);
    } else {
      processJoin(serverName, url);
    }
  };

  // ── Tauri event listener (backup path) ──
  function listenTauriEvents() {
    let attempts = 0;
    const register = () => {
      const listen = window.__TAURI__?.event?.listen;
      if (listen) {
        listen('server-detected', (event) => {
          const { serverName, joinUrl } = event.payload ?? {};
          if (serverName || joinUrl) onServerSelected(serverName, joinUrl);
        }).catch((e) => console.warn('[CacheManager] event listen failed:', e));
        return;
      }
      if (attempts++ < 60) setTimeout(register, 100);
    };
    register();
  }

  // ── Prerequisite Polling ──
  let latestPrereqs = { steam: true, discord: true };

  async function pollPrerequisites() {
    if (!dom.prereqSteam || !dom.prereqDiscord) return;
    try {
      const status = await tauriInvoke('check_prerequisites');
      if (status) {
        latestPrereqs = status;
        dom.prereqsContainer.title = 'Status aplikasi pendukung';
        
        if (status.steam) {
          dom.prereqSteam.classList.add('fcm-prereq-ok');
          dom.prereqSteam.title = 'Steam sedang berjalan';
        } else {
          dom.prereqSteam.classList.remove('fcm-prereq-ok');
          dom.prereqSteam.title = 'Steam tidak berjalan! FiveM mungkin membutuhkan Steam.';
        }

        if (status.discord) {
          dom.prereqDiscord.classList.add('fcm-prereq-ok');
          dom.prereqDiscord.title = 'Discord sedang berjalan';
        } else {
          dom.prereqDiscord.classList.remove('fcm-prereq-ok');
          dom.prereqDiscord.title = 'Discord tidak berjalan! FiveM RPC membutuhkan Discord.';
        }
      }
    } catch (e) {
      console.warn('[CacheManager] Prerequisite check failed:', e);
    }
  }

  // ── Steam Warning Modal ──
  let pendingJoinAction = null;

  function checkSteamBeforeJoin(joinAction) {
    if (latestPrereqs.steam) {
      joinAction();
    } else {
      pendingJoinAction = joinAction;
      dom.modalOverlay?.classList.add('fcm-visible');
    }
  }

  function handleModalCancel() {
    dom.modalOverlay?.classList.remove('fcm-visible');
    pendingJoinAction = null;
  }

  function handleModalContinue() {
    dom.modalOverlay?.classList.remove('fcm-visible');
    if (pendingJoinAction) {
      pendingJoinAction();
      pendingJoinAction = null;
    }
  }

  // ── SPA / lifecycle ──
  let listenerAttached = false;
  let prereqInterval = null;

  function attachListener() {
    if (listenerAttached) return;
    document.addEventListener('pointerdown', handleJoinPointerDown, { capture: true });
    document.addEventListener('click', handleJoinClick, { capture: true });
    listenerAttached = true;
    console.log('[CacheManager] Content script ready — listening for Join clicks');

    pollPrerequisites();
    if (!prereqInterval) prereqInterval = setInterval(pollPrerequisites, 5000);

    // Bind modal buttons
    dom.modalBtnCancel?.addEventListener('click', handleModalCancel);
    dom.modalBtnContinue?.addEventListener('click', handleModalContinue);
  }

  function onDomReady() {
    injectActionBar();
    listenTauriEvents();
    attachListener();

    const observer = new MutationObserver(() => {
      if (!document.getElementById('fcm-action-bar')) injectActionBar();
      attachListener();
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady);
  } else {
    onDomReady();
  }

  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    origPushState(...args);
    setTimeout(() => {
      checkNavigationReset();
      attachListener();
    }, 300);
  };

  window.addEventListener('popstate', () => {
    setTimeout(() => {
      checkNavigationReset();
      attachListener();
    }, 300);
  });

})();

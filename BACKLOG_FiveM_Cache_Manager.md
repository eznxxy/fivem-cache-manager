# Backlog — FiveM Cache Manager

> Total: 28 task | Stack: Tauri v2 (Rust + WebView) | Target OS: Windows 10/11

---

## Fase 1 — Setup & Boilerplate (4 task)

### T-01 · Init project Tauri v2 dengan template default
**Prioritas:** Tinggi | **Kategori:** Rust  
**Acceptance criteria:**
- Jalankan `cargo tauri init` dan verifikasi build berhasil
- Struktur folder: `src/` (frontend), `src-tauri/` (Rust)
- Pastikan WebView2 terdeteksi di Windows

---

### T-02 · Tambah dependency Rust: fs_extra, serde, tauri-plugin-store
**Prioritas:** Tinggi | **Kategori:** Rust | **Depends on:** T-01  
**Acceptance criteria:**
- `fs_extra` untuk recursive folder move
- serde + serde_json untuk serialisasi config
- tauri-plugin-store atau custom JSON reader
- Cargo.toml updated, `cargo build` sukses

---

### T-03 · Setup frontend stack (Vanilla JS + CSS variables)
**Prioritas:** Sedang | **Kategori:** Frontend | **Depends on:** T-01  
**Acceptance criteria:**
- Buat index.html, style.css, main.js di `src/`
- Import Tauri JS API via `@tauri-apps/api`
- Pastikan hot-reload dev mode berjalan

---

### T-04 · Konfigurasi tauri.conf.json: window size, title, no-decorations
**Prioritas:** Sedang | **Kategori:** Config | **Depends on:** T-01  
**Acceptance criteria:**
- Window: 1200×800, resizable true
- Title: FiveM Cache Manager
- allowlist: shell, fs, path diaktifkan

---

## Fase 2 — WebView & Content Script (4 task)

### T-05 · Load servers.fivem.net di WebView sebagai halaman utama
**Prioritas:** Tinggi | **Kategori:** Frontend | **Depends on:** T-03  
**Acceptance criteria:**
- WebView mengisi area utama window (di atas action bar)
- URL awal: `https://servers.fivem.net/`
- Navigasi dalam domain cfx.re diizinkan
- Navigasi keluar domain dikembalikan ke servers.fivem.net

---

### T-06 · Inject content script ke setiap page load di cfx.re
**Prioritas:** Tinggi | **Kategori:** Frontend | **Depends on:** T-05  
**Acceptance criteria:**
- Script diinjeksi via `tauri::webview` initialization_script
- Listen click event pada tombol Join/Connect di server card
- Selector dicek manual via DevTools di live site
- Script tidak crash jika elemen tidak ditemukan

---

### T-07 · Ekstrak server name & join URL dari DOM server card
**Prioritas:** Tinggi | **Kategori:** Frontend | **Depends on:** T-06  
**Acceptance criteria:**
- Ambil teks nama server dari elemen yang benar
- Ambil `fivem://` connect URL atau IP:port
- Fallback jika salah satu null: log error, tidak crash
- Uji dengan minimal 3 server berbeda di cfx.re

---

### T-08 · Kirim server_selected event ke Rust via invoke()
**Prioritas:** Tinggi | **Kategori:** IPC | **Depends on:** T-07  
**Acceptance criteria:**
- `window.__TAURI__.invoke('server_selected', {serverName, joinUrl})`
- `e.preventDefault()` menahan navigasi asli
- Rust handler menerima dan log payload
- Action bar terupdate saat event diterima

---

## Fase 3 — Rust Cache Swap Core (6 task)

### T-09 · Buat struct AppConfig + load/save config.json
**Prioritas:** Tinggi | **Kategori:** Rust | **Depends on:** T-02  
**Acceptance criteria:**
- Field: `fivem_data_path`, `auto_detect`, `restore_previous`, `last_used_folder`
- Default path: `D:\Games\FiveM\FiveM.app\data`
- Simpan ke app data dir (bukan working dir)
- Buat file baru jika belum ada

---

### T-10 · Command get_server_folders: scan subfolder di data path
**Prioritas:** Tinggi | **Kategori:** Rust | **Depends on:** T-09  
**Acceptance criteria:**
- List immediate subdirectory dari `data_path`
- Filter: hanya folder yang punya ≥1 dari `[cache, server-cache, server-cache-priv]`
- Return `Vec<String>` nama folder
- Handle error jika path tidak ada atau tidak bisa diakses

---

### T-11 · Implementasi fuzzy matching server name vs folder name
**Prioritas:** Tinggi | **Kategori:** Rust | **Depends on:** T-10  
**Acceptance criteria:**
- Normalize: lowercase, hapus karakter spesial (`[^a-z0-9 ]`)
- Exact match dulu, lalu contains, lalu Levenshtein distance ≤3
- Return matched folder name atau `None`
- Unit test: 5 kasus nama server dengan variasi spasi/simbol

---

### T-12 · Command swap_cache: pindah cache dari subfolder ke data root
**Prioritas:** Tinggi | **Kategori:** Rust | **Depends on:** T-11  
**Acceptance criteria:**
- Input: `server_name: String`
- Panggil fuzzy match → dapat folder path
- Untuk tiap `[cache, server-cache, server-cache-priv]`: `fs_extra::move_items` ke data root
- Overwrite jika sudah ada di root
- Return `SwapResult { success, matched_folder, message }`

---

### T-13 · Restore cache server sebelumnya sebelum swap baru
**Prioritas:** Tinggi | **Kategori:** Rust | **Depends on:** T-12  
**Acceptance criteria:**
- Baca `last_used_folder` dari config
- Jika ada cache di root DAN `last_used_folder` ada: pindah balik dulu
- Lalu lanjut swap baru (T-12)
- Toggle-able via `config.restore_previous`

---

### T-14 · Error handling Rust: permission, path tidak ada, partial move
**Prioritas:** Sedang | **Kategori:** Rust | **Depends on:** T-13  
**Acceptance criteria:**
- Permission error → return pesan spesifik + saran run as admin
- Folder tidak ditemukan → `success=false`, message deskriptif
- Partial move (sebagian folder gagal) → log apa yang berhasil
- Semua error dikirim ke frontend sebagai string yang bisa ditampilkan

---

## Fase 4 — Action Bar UI (5 task)

### T-15 · Buat action bar HTML: persistent di bawah window
**Prioritas:** Tinggi | **Kategori:** Frontend | **Depends on:** T-03  
**Acceptance criteria:**
- Tinggi fixed ~56px, selalu visible
- Tidak overlap WebView (WebView height = window height − bar height)
- Background `var(--color-background-primary)`, border-top 0.5px

---

### T-16 · Status indicator di action bar: idle/detected/swapping/done/error
**Prioritas:** Tinggi | **Kategori:** Frontend | **Depends on:** T-15  
**Acceptance criteria:**
- Idle: "Pilih server dari daftar di atas"
- Detected: "Ditemukan: `<nama server>` — folder: `<matched>`"
- Swapping: spinner + "Sedang memindahkan cache..."
- Done: "✓ Cache siap — FiveM sedang dibuka"
- Error: pesan error dari Rust, warna merah

---

### T-17 · Tombol Swap & Join di action bar
**Prioritas:** Tinggi | **Kategori:** Frontend | **Depends on:** T-16  
**Acceptance criteria:**
- Invoke `swap_cache` lalu buka joinUrl via `shell.open()`
- Disabled saat status = swapping
- Tidak muncul saat status = idle

---

### T-18 · Tombol Join Without Swap di action bar
**Prioritas:** Sedang | **Kategori:** Frontend | **Depends on:** T-16  
**Acceptance criteria:**
- Buka joinUrl langsung tanpa invoke `swap_cache`
- Selalu visible saat server terdeteksi
- Konfirmasi singkat sebelum membuka

---

### T-19 · Reset action bar saat WebView navigasi keluar cfx.re
**Prioritas:** Rendah | **Kategori:** IPC | **Depends on:** T-08  
**Acceptance criteria:**
- Listen navigation event dari WebView
- Jika URL bukan `*.cfx.re` / `*.fivem.net` → reset state ke idle
- Matched folder dan join URL dihapus dari state

---

## Fase 5 — Settings (4 task)

### T-20 · Settings panel: input path FiveM data
**Prioritas:** Sedang | **Kategori:** Config | **Depends on:** T-09  
**Acceptance criteria:**
- Input text field untuk `fivem_data_path`
- Tombol Browse (buka folder picker via dialog)
- Validasi: path harus ada dan readable
- Simpan ke config.json saat klik Save

---

### T-21 · Settings panel: toggle auto-detect & restore previous cache
**Prioritas:** Sedang | **Kategori:** Config | **Depends on:** T-20  
**Acceptance criteria:**
- 2 toggle switch: `auto_detect_server`, `restore_previous_cache`
- Default keduanya ON
- Simpan ke config.json real-time saat toggle berubah

---

### T-22 · Tampilkan daftar folder server yang terdeteksi di Settings
**Prioritas:** Rendah | **Kategori:** Config | **Depends on:** T-21  
**Acceptance criteria:**
- Invoke `get_server_folders` saat Settings dibuka
- Tampilkan sebagai list nama folder
- Tombol refresh untuk re-scan
- Info kosong jika tidak ada folder ditemukan

---

### T-23 · Gear icon di action bar membuka/tutup Settings panel
**Prioritas:** Sedang | **Kategori:** Frontend | **Depends on:** T-20  
**Acceptance criteria:**
- Klik gear → Settings slide down atau modal
- Klik lagi atau tombol X → tutup
- Settings tidak menutup WebView secara permanen

---

## Fase 6 — QA & Edge Cases (5 task)

### T-24 · Test: WebView load dan navigasi cfx.re
**Prioritas:** Sedang | **Kategori:** QA | **Depends on:** T-05  
**Acceptance criteria:**
- servers.fivem.net tampil saat launch
- Scroll, filter, search di halaman berfungsi normal
- Navigasi ke halaman server detail berfungsi
- Navigasi kembali ke list berfungsi

---

### T-25 · Test: ekstraksi nama server dari 10+ server berbeda
**Prioritas:** Tinggi | **Kategori:** QA | **Depends on:** T-07  
**Acceptance criteria:**
- Uji server dengan nama pendek, panjang, simbol
- Uji server dengan nama non-ASCII / bahasa lain
- Verifikasi joinUrl yang diekstrak adalah `fivem://` URL valid
- Tidak ada crash jika Join diklik pada server tanpa nama

---

### T-26 · Test: skenario swap cache end-to-end
**Prioritas:** Tinggi | **Kategori:** QA | **Depends on:** T-13  
**Acceptance criteria:**
- Swap berhasil: cache dipindah ke root, verifikasi dengan dir listing
- Restore sebelumnya: cache lama kembali ke subfoldernya
- No match: pesan muncul, Join Without Swap tetap bisa
- Permission error: pesan muncul, app tidak crash

---

### T-27 · Test: edge cases folder dan path
**Prioritas:** Sedang | **Kategori:** QA | **Depends on:** T-14  
**Acceptance criteria:**
- Data path salah → prompt Settings muncul
- Folder server ada tapi kosong (tidak ada subfolder cache) → no match
- Sebagian subfolder cache ada (misal hanya `cache`, tidak `server-cache`) → partial swap
- FiveM tidak terinstall → error jelas

---

### T-28 · Test: config persist dan settings
**Prioritas:** Rendah | **Kategori:** QA | **Depends on:** T-22  
**Acceptance criteria:**
- Path yang diubah di Settings tersimpan setelah restart
- Toggle `restore_previous` bekerja (off = tidak restore)
- `last_used_folder` terupdate setelah setiap swap sukses

---

## Dependency Map

```
T-01 ──┬── T-02 ── T-09 ── T-10 ── T-11 ── T-12 ── T-13 ── T-14
       │                                              │
       ├── T-03 ──┬── T-05 ── T-06 ── T-07 ── T-08 ──┘
       │          │                          └── T-19
       │          ├── T-15 ── T-16 ──┬── T-17
       │          │                  └── T-18
       │          └── (T-20 depends T-09)
       └── T-04
       
T-09 ── T-20 ── T-21 ── T-22 ── T-23

QA: T-24(←T-05) · T-25(←T-07) · T-26(←T-13) · T-27(←T-14) · T-28(←T-22)
```

---

## Ringkasan

| Fase | Task | Prioritas Tinggi |
|------|------|-----------------|
| 1 — Setup | 4 | 2 |
| 2 — WebView | 4 | 4 |
| 3 — Rust Core | 6 | 5 |
| 4 — Action Bar UI | 5 | 3 |
| 5 — Settings | 4 | 0 |
| 6 — QA | 5 | 2 |
| **Total** | **28** | **16** |

# LightBridge dependency decisions

## Frontend

| Package | Decision | Why |
| --- | --- | --- |
| `@astryxdesign/core` + `theme-neutral` | **Selected** | Required design system; layout/chat primitives; tokens. |
| React 19 + Vite 6 + TypeScript | **Selected** | Current Tauri 2 webview stack. |
| Zustand | **Selected** | Transient UI only (composer, stream buffer, context selection). |
| TanStack Query | **Selected** | Backend-owned conversations/messages/captures. |
| `@openai/chatkit-react` | **Not used** | Astryx Chat components provide the complete overlay while Bifrost supplies a provider-neutral backend. |
| StyleX compiler | **Not used** | Astryx guidelines: no StyleX/Tailwind compiler; use component props + CSS tokens. |

## Rust / Tauri host

| Crate | Decision | Why |
| --- | --- | --- |
| `tauri` 2 + plugins `global-shortcut`, `notification`, `updater` | **Selected** | Overlay lifecycle, tray, shortcut, notifications, signed updates. |
| `xcap` | **Selected** | Exact-HWND capture without hand-rolling WGC. Protected/minimized windows fail with an actionable error. |
| `windows` (Win32 + WinRT OCR) | **Selected** | Foreground HWND, DPI, process path; `Windows.Media.Ocr` for on-device OCR. |
| `windows-capture` | **Rejected (v1)** | More powerful WGC binding, higher integration cost; revisit if xcap fails on target apps. |
| `rusqlite` bundled + FTS5 | **Selected** | Local persistence, WAL, FTS search without a separate DB server. |
| Vector DB server | **Rejected** | Spec forbids separate vector DB process. Future: sqlite-vss / embedded vectors. |
| `keyring` | **Selected** | Windows Credential Manager for provider, Bifrost encryption, virtual-key, and external-gateway secrets; never returned to the webview. |
| `reqwest` + rustls | **Selected** | Verified Bifrost download, gateway health/model discovery, and normalized Responses streaming from Rust only. |
| `image` | **Selected** | PNG/JPEG encode, previews, hashing input. |
| AgentOS | **Deferred** | Requires packaging sandbox runtime + bindings + action-review pipeline; not faked. |

## Managed gateway

| Component | Decision |
| --- | --- |
| Maxim Bifrost `v1.6.5` | **Selected** — downloaded from the official transport URL on first provider setup, pinned by exact size and SHA-256, then run on authenticated loopback. |
| AgentOS guest VM | **Deferred** — same. |

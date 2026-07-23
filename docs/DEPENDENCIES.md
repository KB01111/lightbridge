# LightBridge dependency decisions

## Frontend

| Package | Decision | Why |
| --- | --- | --- |
| `@astryxdesign/core` + `theme-neutral` | **Selected** | Required design system; layout/chat primitives; tokens. |
| React 19 + Vite 6 + TypeScript | **Selected** | Current Tauri 2 webview stack. |
| Zustand | **Selected** | Transient UI only (composer, stream buffer, expand). |
| TanStack Query | **Selected** | Backend-owned conversations/messages/captures. |
| `@openai/chatkit-react` | **Deferred** | Official ChatKit React surface needs a certified server bridge/sidecar. Current UI uses Astryx Chat* components with a real OpenAI streaming host path so the product is usable without a fake ChatKit shell. |
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
| `keyring` | **Selected** | Windows Credential Manager for OpenAI key; never returned to webview. |
| `reqwest` + rustls | **Selected** | OpenAI Responses API multimodal streaming from Rust only. |
| `image` | **Selected** | PNG/JPEG encode, previews, hashing input. |
| AgentOS | **Deferred** | Requires packaging sandbox runtime + bindings + action-review pipeline; not faked. |

## Sidecars

| Component | Decision |
| --- | --- |
| ChatKit Python server sidecar | **Deferred** — verify official SDK packaging; loopback + auth design documented in LIMITATIONS. |
| AgentOS guest VM | **Deferred** — same. |

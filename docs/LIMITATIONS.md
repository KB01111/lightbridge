# LightBridge — honest limitations (current tree)

This repository implements a **working vertical slice** of LightBridge on Windows:

- Tauri 2 host with tray + `Ctrl+Shift+Space`
- Foreground HWND resolve before overlay focus
- Window capture (`xcap`) with self-capture refusal
- Windows.Media.Ocr pipeline (background)
- SQLite (WAL, FTS5) for conversations, messages, captures, memory search
- OpenAI Chat Completions streaming from Rust (API key in Windows Credential Manager)
- Astryx dark-first overlay UI with removable context tokens

It does **not** yet claim full parity with the original multi-week product brief.

## Not implemented yet (do not treat as done)

1. **OpenAI ChatKit React + official ChatKit server sidecar** — deferred; Astryx chat surface + host streaming used instead.
2. **AgentOS sandboxed sessions, bindings, resource limits, action-review** — deferred (no fake agent success paths).
3. **Document ingestion** for PDF/DOCX/XLSX/PPTX + folder watching + embeddings/vector retrieval — not shipped.
4. **Full Windows Graphics Capture** path for protected/hardware-accelerated edge cases — xcap first.
5. **Configurable global shortcut UI**, rich notifications, crash/stream recovery polish — partial.
6. **Production installer signing**, real multi-size `.ico`/`.icns` branding assets — placeholders.
7. **End-to-end automated UI tests** driving the live overlay — smoke scripts cover typecheck/unit/rust tests.

## Runtime requirements

- Windows 11 recommended
- WebView2
- Optional: OpenAI API key via Settings (stored in Credential Manager)
- OCR languages installed in Windows language pack for `Windows.Media.Ocr`

## Security posture (current)

- Narrow Tauri commands (no arbitrary FS/HTTP/shell from the webview)
- CSP restricts connect-src to self, loopback, and `api.openai.com`
- Provider key never returned to React
- Captured OCR/context treated as untrusted in the system prompt
- Agent-side host mutation path intentionally absent until action-review lands

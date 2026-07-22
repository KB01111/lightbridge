# LightBridge

Windows-only AI context overlay (Tauri 2 + React 19 + Astryx).

## Quick start

```powershell
pnpm install
pnpm tauri dev
```

Global shortcut: `Ctrl+Shift+Space` (captures the previous foreground window, runs OCR, opens the overlay).

Configure an OpenAI API key in **Settings** (stored in Windows Credential Manager).

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite only |
| `pnpm tauri:dev` | Full desktop app |
| `pnpm build` | Typecheck + frontend production build |
| `pnpm tauri:build` | Windows package |
| `pnpm test` | Frontend unit tests |
| `pnpm validate` | Local full validation |
| `pnpm validate:ui` / `validate:rust` / `validate:windows` | Scoped validation |

## Docs

- `docs/DEPENDENCIES.md` — crate/package choices
- `docs/LIMITATIONS.md` — what is and is not implemented
- `AGENTS.md` — Astryx agent conventions

## Product metadata

- Name: **LightBridge**
- Identifier: `com.lightbridge.desktop`
- App data: `%AppData%\LightBridge`

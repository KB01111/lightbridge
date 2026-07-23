# LightBridge

Privacy-first Windows AI context overlay (Tauri 2 + React 19 + Astryx).

## Quick start

```powershell
pnpm install
pnpm tauri dev
```

The default global shortcut is `Ctrl+Shift+Space`. It captures the previous
foreground window, runs local OCR, and opens the overlay.

Configure an OpenAI API key in **Settings**. It is stored in Windows Credential
Manager. Screenshots and OCR remain local until the user sends them, and
provider requests are made only by the Rust host through the Responses API.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite only |
| `pnpm tauri:dev` | Full desktop app |
| `pnpm build` | Typecheck + frontend production build |
| `pnpm tauri:build` | Windows package |
| `pnpm test` | Frontend unit tests |
| `pnpm test:e2e` | Native Tauri/WebDriver acceptance |
| `pnpm validate` | Local full validation |
| `pnpm validate:ui` / `validate:rust` / `validate:windows` | Scoped validation |

## Docs

- `docs/DEPENDENCIES.md` - crate/package choices
- `docs/LIMITATIONS.md` - release boundaries
- `docs/release.md` - signing, updater, and native acceptance
- `AGENTS.md` - Astryx agent conventions

## Product metadata

- Name: **LightBridge**
- Candidate version: `0.2.0-rc.1`
- Identifier: `com.lightbridge.desktop`
- App data: `%AppData%\LightBridge`

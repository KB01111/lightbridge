# Windows release gate

LightBridge releases only from a version-matching `v*` tag. The workflow
produces x64 NSIS, MSI, updater archives/signatures, and `latest.json`.

Keep `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json` on the same semantic version. WiX requires its
own numeric `major.minor.patch.build` value; the `0.2.0-rc.1` candidate maps
to `bundle.windows.wix.version = "0.2.0.1"`.

Before the first tag:

1. Generate a Tauri updater signing key outside the repository.
2. Commit only its public key in `src-tauri/tauri.conf.json`.
3. Store the private key and optional password as
   `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secrets.
4. Store the Authenticode PFX and password as
   `WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`.

Never commit either private key or the PFX. The release job refuses to build
when the updater public-key placeholder or required signing secrets remain.

## Interactive Windows 11 acceptance

- Open a fixture window and invoke the configured global shortcut.
- Confirm the exact target thumbnail, OCR completion, and a visual answer.
- Cancel a streamed answer, retry it, restart, and confirm recovery.
- Reuse and delete captures; search and open their owning chats.
- Exercise 360, 400, and 480-pixel widths with keyboard-only navigation.
- Install NSIS, update to the staged build, uninstall, then repeat with MSI.
- Confirm diagnostics contain no credentials, screenshots, OCR, messages,
  window titles, or process paths.

Stage `v0.2.0-rc.1` as a draft prerelease. Promote to `v1.0.0` only after
this checklist passes with a provisioned Authenticode certificate.

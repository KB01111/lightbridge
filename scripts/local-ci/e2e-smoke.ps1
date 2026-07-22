$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

Write-Host "== LightBridge e2e-smoke =="
# Headless smoke: typecheck + unit tests + rust lib tests.
# Full interactive shortcut/OCR e2e requires a desktop session with the built app.
pnpm exec tsc -p tsconfig.json --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm run test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Push-Location src-tauri
cargo test --lib
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { exit $code }
Write-Host "e2e-smoke OK (automated slice)"

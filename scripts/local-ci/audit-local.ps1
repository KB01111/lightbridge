$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

Write-Host "== LightBridge audit:local =="
pnpm audit --prod
Write-Host "pnpm audit exit: $LASTEXITCODE"
Set-Location src-tauri
cargo audit 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "cargo-audit not installed or found issues (non-fatal for local smoke)"
}
Write-Host "audit:local finished"

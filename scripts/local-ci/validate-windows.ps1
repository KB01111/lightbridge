$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

Write-Host "== LightBridge validate:windows =="
if ($env:OS -notlike "*Windows*") {
  Write-Error "validate:windows requires Windows"
  exit 1
}

# tauri CLI rejects CI=1 (expects true/false)
Remove-Item Env:CI -ErrorAction SilentlyContinue

pnpm exec tauri build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "validate:windows OK"

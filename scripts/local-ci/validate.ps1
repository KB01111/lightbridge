$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

Write-Host "== LightBridge validate (full local) =="
& "$PSScriptRoot\validate-ui.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& "$PSScriptRoot\validate-rust.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Production frontend already built in validate-ui; Windows Tauri build is opt-in heavy.
# Include it when LB_SKIP_TAURI_BUILD is not set.
if (-not $env:LB_SKIP_TAURI_BUILD) {
  & "$PSScriptRoot\validate-windows.ps1"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "Skipping Tauri build (LB_SKIP_TAURI_BUILD set)"
}

Write-Host "validate OK"

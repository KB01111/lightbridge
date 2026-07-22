$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\..\src-tauri"))

Write-Host "== LightBridge validate:rust =="
cargo fmt --all -- --check
if ($LASTEXITCODE -ne 0) {
  Write-Host "cargo fmt check failed - running fmt"
  cargo fmt --all
}

cargo clippy --all-targets -- -D warnings
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

cargo test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "validate:rust OK"

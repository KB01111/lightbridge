$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

Write-Host "== LightBridge validate:ui =="
pnpm exec tsc -p tsconfig.json --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

pnpm run test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

pnpm exec vite build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "validate:ui OK"

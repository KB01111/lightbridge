$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

Write-Host "== LightBridge profile:local =="
$sw = [System.Diagnostics.Stopwatch]::StartNew()
pnpm exec vite build
$sw.Stop()
Write-Host ("Frontend production build: {0:N1}s" -f $sw.Elapsed.TotalSeconds)

if (Test-Path "dist") {
  $bytes = (Get-ChildItem dist -Recurse -File | Measure-Object -Property Length -Sum).Sum
  Write-Host ("dist size: {0:N1} MB" -f ($bytes / 1MB))
}

Write-Host "profile:local OK"

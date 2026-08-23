$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Building Turkey Bowling production client..." -ForegroundColor Cyan
npm run build:client

$dist = Join-Path $root "client\dist"
if (-not (Test-Path (Join-Path $dist "index.html"))) {
  throw "Build completed but client\dist\index.html was not found."
}

$releaseDir = Join-Path $root "releases"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$zip = Join-Path $releaseDir "turkey-bowling-itch-v0.6.2.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Host ""
Write-Host "ITCH.IO ZIP READY:" -ForegroundColor Green
Write-Host $zip -ForegroundColor Yellow
Write-Host ""
Write-Host "The ZIP root contains index.html and the built assets directly." -ForegroundColor Green

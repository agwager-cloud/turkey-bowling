$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Verifying critical Turkey Bowling features..." -ForegroundColor Cyan
npm run verify:critical

Write-Host "Building Turkey Bowling production client..." -ForegroundColor Cyan
npm run build:client

$dist = Join-Path $root "client\dist"
$indexPath = Join-Path $dist "index.html"
if (-not (Test-Path $indexPath)) {
  throw "Build completed but client\dist\index.html was not found."
}

# itch.io HTML5 uploads run from a generated nested URL. Absolute /assets/ URLs
# point at itch.io itself and 404, so reject them before packaging.
$indexHtml = Get-Content -Raw $indexPath
if ($indexHtml -match '(?:src|href)=["'']/(?!/)' ) {
  throw "ITCH BUILD BLOCKED: index.html contains a root-absolute asset URL. client/vite.config.ts must use base: './'."
}

# Collect local JS/CSS module/style references from the generated index.
$matches = [regex]::Matches($indexHtml, '(?:src|href)=["''](?<path>[^"'']+\.(?:js|css))["'']')
$refs = @()
foreach ($match in $matches) {
  $ref = $match.Groups['path'].Value
  if ($ref -match '^(?:https?:)?//') { continue }
  $clean = ($ref -replace '^\./', '')
  $refs += $clean
  $diskPath = Join-Path $dist ($clean -replace '/', '\')
  if (-not (Test-Path $diskPath)) {
    throw "ITCH BUILD BLOCKED: index.html references '$ref' but '$diskPath' does not exist."
  }
}
if ($refs.Count -eq 0) {
  throw "ITCH BUILD BLOCKED: no generated JS/CSS references were found in index.html."
}

$releaseDir = Join-Path $root "releases"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$zip = Join-Path $releaseDir "turkey-bowling-itch-v0.7.26.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

# Put the *contents* of dist at ZIP root, never the dist folder itself.
Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zip -CompressionLevel Optimal

# Verify the completed ZIP, not just dist. This catches incomplete archive
# creation—the exact failure mode that produces itch.io JS/CSS 404s.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  $entries = @{}
  foreach ($entry in $archive.Entries) {
    $entries[$entry.FullName.Replace('\\','/')] = $true
  }
  if (-not $entries.ContainsKey('index.html')) {
    throw "ITCH BUILD BLOCKED: final ZIP does not contain index.html at its root."
  }
  foreach ($ref in $refs) {
    $zipRef = $ref.Replace('\\','/')
    if (-not $entries.ContainsKey($zipRef)) {
      throw "ITCH BUILD BLOCKED: final ZIP is missing '$zipRef', which index.html references."
    }
  }
}
finally {
  $archive.Dispose()
}

Write-Host ""
Write-Host "ITCH.IO ZIP VERIFIED AND READY:" -ForegroundColor Green
Write-Host $zip -ForegroundColor Yellow
Write-Host ""
Write-Host "Verified index.html plus all referenced JS/CSS assets inside the ZIP." -ForegroundColor Green

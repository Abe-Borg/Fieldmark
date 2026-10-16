$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.12 or newer (24 LTS recommended) first.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm is required.' }
if (Test-Path -LiteralPath 'package-lock.json') { & npm.cmd ci } else { & npm.cmd install }
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check registry and Electron download access.' }
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed. Installer build stopped.' }
& npm.cmd run package:win
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed. See the preceding build output. If the electron-builder tool download failed to extract with a symbolic-link privilege error, enable Windows Developer Mode or run this script once from an elevated PowerShell.' }
$version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
$installer = Join-Path 'release' "Fieldmark-Setup-$version.exe"
if (-not (Test-Path -LiteralPath $installer)) { throw "Packaging finished but $installer was not found." }
Write-Output "Installer ready: $installer"

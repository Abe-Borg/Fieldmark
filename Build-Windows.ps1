$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS first.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm is required.' }
if (Test-Path -LiteralPath 'package-lock.json') { & npm.cmd ci } else { & npm.cmd install }
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check registry and Electron download access.' }
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed. Installer build stopped.' }
& npm.cmd run package:win
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed. See the preceding build output.' }
Write-Output 'Installer ready: release\Fieldmark-Setup-0.1.0.exe'

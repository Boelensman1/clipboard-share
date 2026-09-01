#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Register (or remove) the clipboard-share client to start automatically at
  Windows logon.

.DESCRIPTION
  Creates a per-user Scheduled Task that launches `node index.mjs` at logon,
  hidden (no console window), restarts it if it ever exits, and redirects all
  output to a log file. Run from a NORMAL (non-admin) PowerShell as the user who
  will be logged in — a per-user interactive task needs no elevation.

  The client uses the Win32 clipboard APIs, which require an interactive desktop
  session, so it starts at *logon* (not before login as a session-0 service).

.PARAMETER Uninstall
  Remove the previously-registered task instead of installing it.

.PARAMETER Config
  Path to the client config.json. Defaults to config.json in the repo root.

.PARAMETER Node
  Path to node.exe. Defaults to whatever `node` resolves to on PATH.

.PARAMETER TaskName
  Scheduled Task name. Defaults to 'ClipboardShareClient'.

.EXAMPLE
  windows-clipboard\autostart.ps1
  windows-clipboard\autostart.ps1 -Config D:\secrets\clip.json
  windows-clipboard\autostart.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [string]$Config,
  [string]$Node,
  [string]$TaskName = 'ClipboardShareClient'
)

$ErrorActionPreference = 'Stop'

# Repo root is the folder above this script (windows-clipboard/..).
$repoRoot = Split-Path -Parent $PSScriptRoot
$indexPath = Join-Path $repoRoot 'index.mjs'

$dataDir = Join-Path $env:LOCALAPPDATA 'clipboard-share'
$logPath = Join-Path $dataDir 'client.log'

if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
    Write-Host "(Log file left in place: $logPath)"
  } else {
    Write-Host "No scheduled task '$TaskName' found — nothing to remove."
  }
  return
}

# --- Install ---------------------------------------------------------------

if (-not (Test-Path -LiteralPath $indexPath)) {
  throw "Could not find index.mjs at '$indexPath'. Run this script from the repo's windows-clipboard folder."
}

# Resolve node.exe.
if (-not $Node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "node was not found on PATH. Install Node.js (https://nodejs.org) or pass -Node <path to node.exe>."
  }
  $Node = $cmd.Source
}
if (-not (Test-Path -LiteralPath $Node)) {
  throw "node.exe not found at '$Node'."
}

# Resolve the config path (absolute so the task doesn't depend on a working dir).
if (-not $Config) {
  $Config = Join-Path $repoRoot 'config.json'
}
$Config = [System.IO.Path]::GetFullPath($Config)
if (-not (Test-Path -LiteralPath $Config)) {
  Write-Warning "Config file '$Config' does not exist yet. The client will fail to start until it does (see Readme 'Config')."
}

# The client shells out to this helper; warn if it hasn't been built.
$helperPath = Join-Path $PSScriptRoot 'bin\clipboard.exe'
if (-not (Test-Path -LiteralPath $helperPath)) {
  Write-Warning "Clipboard helper '$helperPath' is missing — the client can't sync without it. Build it first with: pnpm build:windows"
}

if (-not (Test-Path -LiteralPath $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

# Inner command run by the hidden powershell host: cd to the repo, run the
# client inline (so node attaches to the hidden console instead of spawning a
# visible one), and append all streams to the log. Single-quote the paths and
# double any embedded single quotes so they survive as PowerShell literals.
function Quote([string]$s) { "'" + ($s -replace "'", "''") + "'" }
$inner = "Set-Location -LiteralPath $(Quote $repoRoot); " +
         "& $(Quote $Node) 'index.mjs' -c $(Quote $Config) *>> $(Quote $logPath)"

# Wrap the inner command as an encoded command so no quoting survives into the
# task's stored argument string (avoids escaping surprises in Task Scheduler).
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
$psArgs = "-WindowStyle Hidden -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -Hidden `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

# Start it now so it's running without waiting for the next logon.
Start-ScheduledTask -TaskName $TaskName

Write-Host "Registered and started scheduled task '$TaskName'."
Write-Host "  Runs at each logon, hidden, and restarts if it exits."
Write-Host "  Config: $Config"
Write-Host "  Log:    $logPath"
Write-Host ""
Write-Host "To remove it later:"
Write-Host "  $PSCommandPath -Uninstall"

<#
.SYNOPSIS
  Registers a Windows Scheduled Task that refreshes the Cowork memory snapshot.

.DESCRIPTION
  Runs pull-tsp-memory.ps1 on a schedule under your own account. Default: every weekday
  at 07:30, plus once at logon (delayed 2 minutes so Tailscale has time to connect).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-task.ps1
  powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -At "06:45" -TaskName "TSP Memory Refresh"
#>

[CmdletBinding()]
param(
  [string]$TaskName   = "Cowork TSP Memory Refresh",
  [string]$At         = "07:30",
  [string]$OutputRoot = "C:\CoworkMemory\tsp-proposals",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
  exit 0
}

$script = Join-Path $PSScriptRoot "pull-tsp-memory.ps1"
if (-not (Test-Path -LiteralPath $script)) { throw "Cannot find $script" }

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"{0}`" -OutputRoot `"{1}`"" -f $script, $OutputRoot)

$triggers = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $At),
  (New-ScheduledTaskTrigger -AtLogOn)
)
# Give Tailscale time to come up before the logon run fires.
$triggers[1].Delay = "PT2M"

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Description "Pulls the TSP proposal memory snapshot from the Agent-Memory brain into the Cowork folder." `
  -Force | Out-Null

Write-Host "Registered '$TaskName' - weekdays at $At, plus 2 minutes after logon."
Write-Host "Run it now with:  Start-ScheduledTask -TaskName `"$TaskName`""

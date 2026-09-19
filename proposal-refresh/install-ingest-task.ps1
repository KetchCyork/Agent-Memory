<#
.SYNOPSIS
  Registers the weekly Windows Scheduled Task that refreshes proposal memory.

.DESCRIPTION
  Runs refresh-proposal-memory.ps1 once a week under your own account.

  Default: Mondays at 06:00, with StartWhenAvailable so a missed run (laptop off,
  asleep, or off the network) fires as soon as the machine is next usable rather
  than being skipped until the following week. The task does not try to wake the
  machine — a corporate laptop usually won't allow it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-ingest-task.ps1
  powershell -ExecutionPolicy Bypass -File .\install-ingest-task.ps1 -DayOfWeek Sunday -At "22:00"
  powershell -ExecutionPolicy Bypass -File .\install-ingest-task.ps1 -Uninstall
#>

[CmdletBinding()]
param(
  [string]$TaskName = "Proposal Memory Refresh",
  [ValidateSet("Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")]
  [string]$DayOfWeek = "Monday",
  [string]$At = "06:00",
  [int]$TimeLimitHours = 6,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
  exit 0
}

$script = Join-Path $PSScriptRoot "refresh-proposal-memory.ps1"
if (-not (Test-Path -LiteralPath $script)) { throw "Cannot find $script" }

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"{0}`"" -f $script)

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $At

# A full pass re-embeds the whole corpus, so give it real headroom — but still
# bound it, so a hung run can't sit there until the next week's trigger.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours $TimeLimitHours) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Re-ingests the SharePoint proposal folder into the Agent-Memory brain so new proposals are drafted against current firm precedent." `
  -Force | Out-Null

Write-Host "Registered '$TaskName' - $DayOfWeek at $At (catches up if the machine was off)."
Write-Host ""
Write-Host "Run it now:        Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "Check last result: Get-ScheduledTaskInfo -TaskName `"$TaskName`""
Write-Host "Logs:              $env:USERPROFILE\.cowork-memory\logs\"

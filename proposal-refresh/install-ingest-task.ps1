<#
.SYNOPSIS
  Registers the weekly Windows Scheduled Task that refreshes proposal memory.

.DESCRIPTION
  Runs refresh-proposal-memory.ps1 once a week under your own account.

  Default: Mondays at 06:00, with StartWhenAvailable so a missed run (laptop off,
  asleep, or off the network) fires as soon as the machine is next usable rather
  than being skipped until the following week. The task does not try to wake the
  machine -- a corporate laptop usually won't allow it.

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
  # Register a DAILY incremental task instead of the weekly full pass. An
  # incremental run takes seconds, so daily is what actually keeps the corpus
  # current; keep the weekly full pass registered alongside it as the backstop.
  [switch]$Daily,
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

$scriptArgs = if ($Daily) { " -ChangedOnly" } else { "" }
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"{0}`"{1}" -f $script, $scriptArgs)

$trigger = if ($Daily) {
  New-ScheduledTaskTrigger -Daily -At $At
} else {
  New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $At
}

# A full pass re-embeds the whole corpus, so give it real headroom -- but still
# bound it, so a hung run can't sit there until the next week's trigger.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours $TimeLimitHours) `
  -MultipleInstances IgnoreNew

# Register-ScheduledTask raises a NON-terminating CimException on an access
# denial, which sails past $ErrorActionPreference and leaves the script printing
# "Registered" for a task that does not exist. Force it to terminate, and verify
# against the task store before claiming anything.
$registered = $false
try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Re-ingests the SharePoint proposal folder into the Agent-Memory brain so new proposals are drafted against current firm precedent." `
    -User $env:USERNAME `
    -RunLevel Limited `
    -Force -ErrorAction Stop | Out-Null
  $registered = $true
} catch {
  Write-Host "Register-ScheduledTask failed: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "Falling back to schtasks.exe ..." -ForegroundColor Yellow

  $dayMap = @{ Monday="MON"; Tuesday="TUE"; Wednesday="WED"; Thursday="THU"; Friday="FRI"; Saturday="SAT"; Sunday="SUN" }
  # No extra arguments: refresh-proposal-memory.ps1 reads everything it needs
  # from the shared config. (-OutputRoot belongs to the bridge script, not this one.)
  $tr = "`"powershell.exe`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"$scriptArgs"
  if ($Daily) {
    & schtasks.exe /Create /TN "$TaskName" /TR $tr /SC DAILY /ST $At /F 2>&1 | ForEach-Object { Write-Host "  $_" }
  } else {
    & schtasks.exe /Create /TN "$TaskName" /TR $tr /SC WEEKLY /D $dayMap[$DayOfWeek] /ST $At /F 2>&1 | ForEach-Object { Write-Host "  $_" }
  }
  if ($LASTEXITCODE -eq 0) { $registered = $true }
}

$check = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $check) { $check = (& schtasks.exe /Query /TN "$TaskName" 2>$null) }

if (-not $check -or -not $registered) {
  Write-Host ""
  Write-Host "FAILED - '$TaskName' was NOT registered." -ForegroundColor Red
  Write-Host "Most likely corporate policy blocks task creation for standard users." -ForegroundColor Red
  Write-Host "Options:" -ForegroundColor Red
  Write-Host "  1. Re-run this script from an elevated PowerShell (Run as administrator)."
  Write-Host "  2. Create it by hand in Task Scheduler - action:"
  Write-Host "       powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
  Write-Host "  3. Skip the schedule and run .\refresh-proposal-memory.ps1 yourself when new proposals land."
  exit 1
}

Write-Host ""
$when = if ($Daily) { "daily at $At (incremental)" } else { "$DayOfWeek at $At (full pass)" }
Write-Host "Registered '$TaskName' - $when (catches up if the machine was off)." -ForegroundColor Green
Write-Host ""
Write-Host "Run it now:        Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "Check last result: Get-ScheduledTaskInfo -TaskName `"$TaskName`""
Write-Host "Logs:              $env:USERPROFILE\.cowork-memory\logs\"

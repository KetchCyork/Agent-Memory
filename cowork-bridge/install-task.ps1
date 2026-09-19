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

# Register-ScheduledTask raises a NON-terminating CimException on an access
# denial, which sails past $ErrorActionPreference and leaves the script printing
# "Registered" for a task that does not exist. Force it to terminate, and verify
# the task is really there before claiming anything.
$registered = $false
try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Description "Pulls the TSP proposal memory snapshot from the Agent-Memory brain into the Cowork folder." `
    -User $env:USERNAME `
    -RunLevel Limited `
    -Force -ErrorAction Stop | Out-Null
  $registered = $true
} catch {
  Write-Host "Register-ScheduledTask failed: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "Falling back to schtasks.exe ..." -ForegroundColor Yellow

  # schtasks often succeeds for a user-scoped task where the CIM route is denied
  # by policy. It takes one schedule, so the logon trigger is a second task.
  $cmd = "powershell.exe"
  $cmdArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -OutputRoot `"$OutputRoot`""
  $tr = "`"$cmd`" $cmdArgs"

  & schtasks.exe /Create /TN "$TaskName" /TR $tr /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST $At /F 2>&1 | ForEach-Object { Write-Host "  $_" }
  if ($LASTEXITCODE -eq 0) {
    $registered = $true
    & schtasks.exe /Create /TN "$TaskName (logon)" /TR $tr /SC ONLOGON /DELAY 0002:00 /F 2>&1 | Out-Null
  }
}

# Trust the task store, not the call that claimed to write to it.
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
  Write-Host "  3. Skip the schedule and run .\pull-tsp-memory.ps1 when you want a fresh snapshot."
  exit 1
}

Write-Host ""
Write-Host "Registered '$TaskName' - weekdays at $At, plus 2 minutes after logon." -ForegroundColor Green
Write-Host "Run it now with:  Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "Verify with:      Get-ScheduledTaskInfo -TaskName `"$TaskName`""

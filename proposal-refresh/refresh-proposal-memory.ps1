<#
.SYNOPSIS
  Re-ingests the SharePoint/OneDrive proposal folder into the Agent-Memory brain.

.DESCRIPTION
  Runs on tspusl098 (the work laptop). Wraps the existing Agent-proposal-ingestion
  CLI, which walks a directory, extracts text from .docx/.pdf and POSTs each
  document to the brain's /ingest endpoint over the tailnet.

  Push direction matters: corporate endpoint protection blocks inbound TCP to this
  machine, so HQ can never pull from here. Everything is initiated locally and
  pushed out.

  Re-ingest is idempotent. The brain's putNoteChunks() deletes every row for a
  notePath before re-adding, so running this over the whole folder replaces
  documents rather than duplicating them. A full run is therefore always safe;
  it is slow, not dangerous.

.PARAMETER ProposalPath
  Folder to ingest. Defaults to the configured proposalPath.

.PARAMETER IngestRepo
  The Agent-proposal-ingestion checkout.

.PARAMETER ConfigPath
  Shared config, same file the Cowork bridge uses:
  { "host": "...", "port": 8377, "apiKey": "...", "proposalPath": "...", "ingestRepo": "..." }

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\refresh-proposal-memory.ps1
  powershell -ExecutionPolicy Bypass -File .\refresh-proposal-memory.ps1 -WhatIfOnly
  powershell -ExecutionPolicy Bypass -File .\refresh-proposal-memory.ps1 -ChangedOnly
#>

[CmdletBinding()]
param(
  [string]$ProposalPath = "",
  [string]$IngestRepo   = "",
  [string]$ConfigPath   = "",
  [string]$LogDir       = "",
  [string]$DocType      = "proposal",
  [int]$TimeoutMinutes  = 240,
  [switch]$WhatIfOnly,
  # Send only what changed since the last run, per the ingestion CLI's manifest.
  # Seconds instead of ~an hour, so this can run daily rather than weekly.
  [switch]$ChangedOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

# ------------------------------------------------------------------ logging
if (-not $ConfigPath) {
  $userRoot = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  $ConfigPath = Join-Path $userRoot ".cowork-memory/config.json"
}
if (-not $LogDir) {
  $userRoot = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  $LogDir = Join-Path $userRoot ".cowork-memory/logs"
}
if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$logFile = Join-Path $LogDir ("proposal-refresh-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))

function Write-Log {
  param([string]$Message, [string]$Level = "INFO")
  $line = "[{0}] {1,-5} {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
  Write-Host $line
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

Write-Log "=== proposal memory refresh starting ==="

# ------------------------------------------------------------ configuration
$cfg = @{ host = $null; port = 8377; apiKey = $null; proposalPath = $null; ingestRepo = $null }

if (Test-Path -LiteralPath $ConfigPath) {
  try {
    $fromFile = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    foreach ($k in @("host", "port", "apiKey", "proposalPath", "ingestRepo")) {
      if ($fromFile.PSObject.Properties.Name -contains $k -and $fromFile.$k) { $cfg[$k] = $fromFile.$k }
    }
    Write-Log "Loaded config from $ConfigPath"
  } catch {
    Write-Log "Could not parse $ConfigPath ($($_.Exception.Message))" "WARN"
  }
} else {
  Write-Log "No config at $ConfigPath" "WARN"
}

if ($env:MEMORY_HOST)    { $cfg.host   = $env:MEMORY_HOST }
if ($env:MEMORY_PORT)    { $cfg.port   = [int]$env:MEMORY_PORT }
if ($env:MEMORY_API_KEY) { $cfg.apiKey = $env:MEMORY_API_KEY }
if ($ProposalPath) { $cfg.proposalPath = $ProposalPath }
if ($IngestRepo)   { $cfg.ingestRepo   = $IngestRepo }

if (-not $cfg.host)         { throw "Memory host not configured. Set `"host`" in $ConfigPath or MEMORY_HOST." }
if (-not $cfg.proposalPath) { throw "Proposal folder not configured. Set `"proposalPath`" in $ConfigPath or pass -ProposalPath." }
if (-not $cfg.ingestRepo)   { throw "Ingestion repo not configured. Set `"ingestRepo`" in $ConfigPath or pass -IngestRepo." }

$baseUrl = "http://$($cfg.host):$($cfg.port)"
Write-Log "Brain:     $baseUrl"
Write-Log "Proposals: $($cfg.proposalPath)"
Write-Log "Ingest repo: $($cfg.ingestRepo)"

# ----------------------------------------------------------------- preflight
if (-not (Test-Path -LiteralPath $cfg.proposalPath)) {
  Write-Log "Proposal folder not found: $($cfg.proposalPath). Is OneDrive/SharePoint synced and signed in?" "ERROR"
  exit 1
}
if (-not (Test-Path -LiteralPath $cfg.ingestRepo)) {
  Write-Log "Ingestion repo not found: $($cfg.ingestRepo)" "ERROR"
  exit 1
}

# The brain requires X-Api-Key on every data route as of 2026-09-18. The ingestion
# CLI reads its own .env, so an empty key there fails as a wall of 401s partway
# through a long run. Catch it here instead.
$ingestEnv = Join-Path $cfg.ingestRepo ".env"
if (Test-Path -LiteralPath $ingestEnv) {
  $keyLine = Select-String -LiteralPath $ingestEnv -Pattern '^\s*MEMORY_API_KEY\s*=\s*(.*)$' | Select-Object -First 1
  $envKey = if ($keyLine) { $keyLine.Matches[0].Groups[1].Value.Trim() } else { "" }
  if (-not $envKey) {
    Write-Log "MEMORY_API_KEY is empty in $ingestEnv -- every /ingest call would return 401." "ERROR"
    Write-Log "Fix: set MEMORY_API_KEY in that file to the brain's key, then re-run." "ERROR"
    exit 1
  }
  if ($cfg.apiKey -and $envKey -ne $cfg.apiKey) {
    Write-Log "MEMORY_API_KEY in $ingestEnv differs from the key in $ConfigPath -- one of them is stale." "WARN"
  }
} else {
  Write-Log "No .env at $ingestEnv; relying on the CLI's own defaults." "WARN"
}

$headers = @{}
if ($cfg.apiKey) { $headers["X-Api-Key"] = $cfg.apiKey }
try {
  $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -Headers $headers -TimeoutSec 20
  if (-not $health.ok) { throw "health endpoint did not return ok" }
  Write-Log "Brain reachable ($($health.service))"
} catch {
  Write-Log "Cannot reach $baseUrl/health - $($_.Exception.Message)" "ERROR"
  Write-Log "Check Tailscale is connected and the memory brain is running on HQ." "ERROR"
  exit 1
}

# What are we about to send?
# Filter on the extension explicitly: -Include is silently ignored alongside
# -LiteralPath, so the earlier version counted every file in the tree --
# .pptx, .xlsx, even .mp4 recordings -- and reported them as documents.
$ingestable = @(".docx", ".pdf")
$allFiles = @(Get-ChildItem -LiteralPath $cfg.proposalPath -Recurse -File -ErrorAction SilentlyContinue)
$docs = @($allFiles | Where-Object { $ingestable -contains $_.Extension.ToLower() })
Write-Log "Found $($allFiles.Count) files in the tree; $($docs.Count) are .docx/.pdf"
$recent = @($docs | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) })
Write-Log "$($recent.Count) of them changed in the last 7 days"

if ($WhatIfOnly) {
  Write-Log "-WhatIfOnly set; stopping before ingest."
  foreach ($d in ($recent | Select-Object -First 25)) { Write-Log "  recent: $($d.FullName)" }
  exit 0
}

# -------------------------------------------------------------------- ingest
# A full pass re-embeds everything, which is why this is scheduled overnight.
# The duration is logged so it's obvious if the corpus outgrows a weekly window.
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$modeLabel = if ($ChangedOnly) { "changed-only" } else { "full pass" }
Write-Log "Starting ingest ($modeLabel, idempotent)..."

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) { Write-Log "npm not found on PATH." "ERROR"; exit 1 }

# Build ONE argument string and quote the path ourselves. Passing an array to
# -ArgumentList joins the elements with spaces and quotes nothing, so a path like
# "D:\The Silicon Partners Inc\..." reached npm as "D:\The" and the ingest died
# with ENOENT. A trailing backslash would escape the closing quote, so trim it.
$proposalArg = $cfg.proposalPath.TrimEnd('\')
$argLine = 'run ingest-remote -- "{0}" --type {1}' -f $proposalArg, $DocType
if ($ChangedOnly) { $argLine += ' --changed-only' }
Write-Log "  $($npm.Source) $argLine"

$proc = Start-Process -FilePath $npm.Source -ArgumentList $argLine `
  -WorkingDirectory $cfg.ingestRepo -NoNewWindow -PassThru `
  -RedirectStandardOutput (Join-Path $LogDir "ingest-stdout.log") `
  -RedirectStandardError  (Join-Path $LogDir "ingest-stderr.log")

if (-not $proc.WaitForExit($TimeoutMinutes * 60 * 1000)) {
  Write-Log "Ingest exceeded $TimeoutMinutes minutes; killing it." "ERROR"
  try { $proc.Kill() } catch {}
  exit 1
}
# The timed overload can return before ExitCode is populated, which is why the
# failure above logged "exit ()" with nothing in it. The parameterless wait
# settles the process and its redirected streams.
$proc.WaitForExit()
$sw.Stop()

# Start-Process + redirected streams does not reliably surface ExitCode, so treat
# it as advisory only. A 54-minute run that ingested 3,264 files and stored
# 118,122 chunks was reported as a hard failure purely because of this value --
# and worse, the old message claimed "Corpus left as it was" when in fact the
# whole corpus had been replaced. Judge the run by what the CLI reported and by
# what the brain actually holds.
$exit = $null
try { $exit = $proc.ExitCode } catch { $exit = $null }
$mins = [math]::Round($sw.Elapsed.TotalMinutes, 1)

$stdoutPath = Join-Path $LogDir "ingest-stdout.log"
foreach ($stream in @("ingest-stdout.log", "ingest-stderr.log")) {
  $p = Join-Path $LogDir $stream
  if (Test-Path -LiteralPath $p) {
    $tail = Get-Content -LiteralPath $p -Tail 15 -ErrorAction SilentlyContinue
    if ($tail) {
      Write-Log "--- tail of $stream ---"
      foreach ($l in $tail) { Write-Log "  $l" }
    }
  }
}

# The CLI's own summary line is the authoritative account of what it did.
$ingested = $null; $chunks = $null; $skipped = $null
if (Test-Path -LiteralPath $stdoutPath) {
  $summary = Select-String -LiteralPath $stdoutPath `
    -Pattern 'Done\.\s+(\d+)\s+files ingested,\s+(\d+)\s+chunks stored\.\s+(\d+)\s+skipped' |
    Select-Object -Last 1
  if ($summary) {
    $ingested = [int]$summary.Matches[0].Groups[1].Value
    $chunks   = [int]$summary.Matches[0].Groups[2].Value
    $skipped  = [int]$summary.Matches[0].Groups[3].Value
  }
}

if ($null -ne $ingested) {
  Write-Log "Ingest reported: $ingested files, $chunks chunks, $skipped skipped, in $mins min"
  if ($ingested -eq 0) {
    if ($ChangedOnly) {
      # Entirely normal: nothing in SharePoint changed since the last run.
      Write-Log "No new or modified documents since the last run."
    } else {
      Write-Log "Nothing was ingested. Check the log tails above." "ERROR"
      exit 1
    }
  }
  if ($exit -ne 0 -and $null -ne $exit) {
    # Completed its work but exited non-zero: worth knowing, not worth failing.
    Write-Log "Note: the CLI exited $exit despite completing. Corpus WAS updated." "WARN"
  }
} elseif ($exit -ne 0) {
  Write-Log "Ingest failed after $mins min (exit $exit) with no summary line -- see tails above." "ERROR"
  Write-Log "Some documents may still have been ingested before it stopped." "ERROR"
  exit 1
} else {
  Write-Log "Ingest finished in $mins min but printed no summary line." "WARN"
}

# ------------------------------------------------------------- verification
# Confirm the brain now holds something ingested today, so a silently-empty run
# can't look like success.
try {
  $today = (Get-Date).ToString("yyyy-MM-dd")
  $body = @{ query = "proposal scope deliverables"; k = 50 } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Uri "$baseUrl/search" -Method Post `
    -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body $body -TimeoutSec 60
  $dates = @($resp.hits | ForEach-Object { ($_.chunk.updated -as [string]) } | Where-Object { $_ })
  $freshest = ($dates | Sort-Object -Descending | Select-Object -First 1)
  Write-Log "Freshest chunk in a sample query: $freshest"
  if ($freshest -and $freshest.StartsWith($today)) {
    Write-Log "Verified: the brain holds chunks ingested today."
  } else {
    Write-Log "No chunks dated today in the sample. If nothing changed in SharePoint this is expected; otherwise check the ingest logs." "WARN"
  }
} catch {
  Write-Log "Post-ingest verification query failed: $($_.Exception.Message)" "WARN"
}

Write-Log "=== refresh finished in $mins minutes ==="
exit 0

<#
.SYNOPSIS
  Creates and validates %USERPROFILE%\.cowork-memory\config.json — the shared
  config used by both the Cowork bridge and the proposal refresh.

.DESCRIPTION
  This file does not ship with the repo; it holds your machine's paths and the
  brain's API key, so you create it once per machine. This script writes it,
  and checks each value before saving rather than leaving you to find out at
  2am on a Monday that the scheduled run has been failing.

  Checks performed:
    - proposal folder exists and contains .docx/.pdf files
    - ingestion repo exists and looks like the right checkout
    - the brain answers /health, and the key is accepted by /search
    - the ingestion repo's own .env has a matching key (offers to fix it)

.EXAMPLE
  # interactive — prompts for anything not supplied
  powershell -ExecutionPolicy Bypass -File .\setup-config.ps1

  # fully specified
  powershell -ExecutionPolicy Bypass -File .\setup-config.ps1 `
    -ApiKey "<key>" `
    -ProposalPath "C:\Users\cyork\OneDrive - TSP\Proposals" `
    -IngestRepo "C:\Users\cyork\Agent-OS\Agent-proposal-ingestion" `
    -UpdateIngestEnv
#>

[CmdletBinding()]
param(
  [string]$ApiKey       = "",
  [string]$ProposalPath = "",
  [string]$IngestRepo   = "",
  [string]$MemoryHost   = "100.74.9.120",
  [int]$MemoryPort      = 8377,
  [switch]$UpdateIngestEnv,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

# Keep param() on its own line. Windows PowerShell 5.1 requires a statement
# separator after the param block; pwsh 7 accepts it inline, which hides the
# error on anything but the machine this actually runs on.
function Say {
  param([string]$m, [string]$c = "Gray")
  Write-Host $m -ForegroundColor $c
}
function Ok {
  param([string]$m)
  Write-Host "  [ok]   $m" -ForegroundColor Green
}
function Bad {
  param([string]$m)
  Write-Host "  [FAIL] $m" -ForegroundColor Red
}
function Note {
  param([string]$m)
  Write-Host "  [note] $m" -ForegroundColor Yellow
}

$userRoot  = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$cfgDir    = Join-Path $userRoot ".cowork-memory"
$cfgPath   = Join-Path $cfgDir "config.json"

Say ""
Say "Shared memory config setup" "Cyan"
Say "  target: $cfgPath"
Say ""

if ((Test-Path -LiteralPath $cfgPath) -and -not $Force) {
  Say "A config already exists here. Current values (key masked):"
  $existing = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
  foreach ($p in $existing.PSObject.Properties) {
    $v = if ($p.Name -eq "apiKey" -and $p.Value) { "<" + $p.Value.Length + " chars>" } else { $p.Value }
    Say ("    {0,-13} {1}" -f $p.Name, $v)
  }
  Say ""
  Say "Re-run with -Force to overwrite it." "Yellow"
  exit 0
}

# ---------------------------------------------------------------- proposals
if (-not $ProposalPath) {
  Say "Looking for synced OneDrive/SharePoint folders..."
  $candidates = @(Get-ChildItem -LiteralPath $userRoot -Directory -Filter "OneDrive*" -ErrorAction SilentlyContinue)
  if ($candidates.Count -eq 0) {
    Note "No OneDrive* folder under $userRoot. Is OneDrive signed in and syncing?"
  } else {
    foreach ($c in $candidates) { Say "    $($c.FullName)" }
  }
  Say ""
  $ProposalPath = Read-Host "Full path to the proposal folder"
}
$ProposalPath = $ProposalPath.Trim('"').Trim()

if (-not (Test-Path -LiteralPath $ProposalPath)) {
  Bad "Proposal folder not found: $ProposalPath"
  exit 1
}
$docCount = @(Get-ChildItem -LiteralPath $ProposalPath -Recurse -File -Include *.docx, *.pdf -ErrorAction SilentlyContinue).Count
if ($docCount -eq 0) {
  Bad "No .docx/.pdf files anywhere under $ProposalPath"
  Note "If OneDrive uses Files On-Demand, placeholders still count — this means the path is wrong."
  exit 1
}
Ok "Proposal folder: $docCount documents found"

# ------------------------------------------------------------- ingest repo
if (-not $IngestRepo) {
  $guess = Join-Path $userRoot "Agent-OS\Agent-proposal-ingestion"
  $prompt = if (Test-Path -LiteralPath $guess) { "Ingestion repo [$guess]" } else { "Full path to Agent-proposal-ingestion" }
  $entered = Read-Host $prompt
  $IngestRepo = if ($entered) { $entered } else { $guess }
}
$IngestRepo = $IngestRepo.Trim('"').Trim()

if (-not (Test-Path -LiteralPath $IngestRepo)) {
  Bad "Ingestion repo not found: $IngestRepo"
  exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $IngestRepo "package.json"))) {
  Bad "$IngestRepo has no package.json — that doesn't look like the checkout."
  exit 1
}
Ok "Ingestion repo: $IngestRepo"

# -------------------------------------------------------------------- key
if (-not $ApiKey) {
  Say ""
  Say "The key is on the HQ Mac. Read it there with:" "Cyan"
  Say "    grep '^MEMORY_API_KEY=' ~/AI/Agent-Memory/agent-memory-mesh/.env | cut -d= -f2-"
  Say ""
  $secure = Read-Host "Paste the MEMORY_API_KEY" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$ApiKey = $ApiKey.Trim()
if (-not $ApiKey) { Bad "No key supplied."; exit 1 }

# ----------------------------------------------------------------- verify
$baseUrl = "http://${MemoryHost}:${MemoryPort}"
Say ""
Say "Checking the brain at $baseUrl ..."

try {
  $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -TimeoutSec 20
  if (-not $health.ok) { throw "health did not return ok" }
  Ok "Brain reachable ($($health.service))"
} catch {
  Bad "Cannot reach $baseUrl/health - $($_.Exception.Message)"
  Note "Check Tailscale is connected here and the brain is running on HQ."
  exit 1
}

# /health is deliberately unauthenticated, so prove the key on a real data route.
try {
  $body = @{ query = "proposal"; k = 1 } | ConvertTo-Json -Compress
  $null = Invoke-RestMethod -Uri "$baseUrl/search" -Method Post -TimeoutSec 45 `
    -Headers @{ "X-Api-Key" = $ApiKey; "Content-Type" = "application/json" } -Body $body
  Ok "API key accepted by /search"
} catch {
  $code = $null
  try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
  if ($code -eq 401) { Bad "The brain rejected that key (401). Check for a stray space or a truncated paste." }
  else { Bad "/search failed: $($_.Exception.Message)" }
  exit 1
}

# ------------------------------------------------------------------ write
if (-not (Test-Path -LiteralPath $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null }

[ordered]@{
  host         = $MemoryHost
  port         = $MemoryPort
  apiKey       = $ApiKey
  proposalPath = $ProposalPath
  ingestRepo   = $IngestRepo
} | ConvertTo-Json | Set-Content -LiteralPath $cfgPath -Encoding UTF8

Ok "Wrote $cfgPath"

# Keep the file to this user — it holds the shared secret.
try {
  $acl = Get-Acl -LiteralPath $cfgPath
  $acl.SetAccessRuleProtection($true, $false)
  $acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    "$env:USERDOMAIN\$env:USERNAME", "FullControl", "Allow")))
  Set-Acl -LiteralPath $cfgPath -AclObject $acl
  Ok "Restricted to $env:USERNAME"
} catch {
  Note "Could not tighten permissions: $($_.Exception.Message)"
}

# --------------------------------------------------- ingestion repo's .env
$ingestEnv = Join-Path $IngestRepo ".env"
if (Test-Path -LiteralPath $ingestEnv) {
  $raw = Get-Content -LiteralPath $ingestEnv -Raw
  $m = [regex]::Match($raw, '(?m)^\s*MEMORY_API_KEY\s*=\s*(.*)$')
  $envKey = if ($m.Success) { $m.Groups[1].Value.Trim() } else { "" }

  if ($envKey -eq $ApiKey) {
    Ok "Ingestion repo .env already has the matching key"
  } elseif ($UpdateIngestEnv) {
    Copy-Item -LiteralPath $ingestEnv -Destination "$ingestEnv.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if ($m.Success) { $updated = [regex]::Replace($raw, '(?m)^\s*MEMORY_API_KEY\s*=.*$', "MEMORY_API_KEY=$ApiKey") }
    else { $updated = $raw.TrimEnd() + "`r`nMEMORY_API_KEY=$ApiKey`r`n" }
    Set-Content -LiteralPath $ingestEnv -Value $updated -Encoding UTF8 -NoNewline:$false
    Ok "Updated MEMORY_API_KEY in $ingestEnv (backup alongside it)"
  } else {
    Say ""
    if (-not $envKey) { Note "MEMORY_API_KEY is EMPTY in $ingestEnv — ingestion returns 401 on every document." }
    else { Note "MEMORY_API_KEY in $ingestEnv does not match — one of them is stale." }
    Note "Re-run with -UpdateIngestEnv to fix it, or edit that file by hand."
  }
} else {
  Note "No .env at $ingestEnv — the ingestion CLI may need one."
}

Say ""
Say "Done. Next:" "Cyan"
Say "    .\refresh-proposal-memory.ps1 -WhatIfOnly     # census, no ingest"
Say "    .\refresh-proposal-memory.ps1                 # first real run, note the duration"
Say "    .\install-ingest-task.ps1                     # schedule it weekly"
Say ""

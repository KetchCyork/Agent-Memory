<#
.SYNOPSIS
  Pulls a TSP proposal memory snapshot from the Agent-Memory brain (HQ MacBook,
  over Tailscale) into a local folder that Claude Cowork can read.

.DESCRIPTION
  Cowork's custom connectors dial out from Anthropic's cloud, so they cannot reach
  a tailnet-only service. Cowork *can* read local files. This script bridges that
  gap: it queries http://<MEMORY_HOST>:<MEMORY_PORT>/search over the tailnet and
  writes the results as markdown into the Cowork folder.

  Fail-soft by design: if the brain is unreachable, the previous snapshot is left
  in place and marked STALE rather than emptied, so Cowork never silently loses
  its context.

.PARAMETER OutputRoot
  Folder Cowork reads. Default: C:\CoworkMemory\tsp-proposals

.PARAMETER ConfigPath
  JSON config. Default: $env:USERPROFILE\.cowork-memory\config.json
  Shape: { "host": "100.74.9.120", "port": 8377, "apiKey": "..." }
  Environment variables MEMORY_HOST / MEMORY_PORT / MEMORY_API_KEY win over the file.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\pull-tsp-memory.ps1
#>

[CmdletBinding()]
param(
  [string]$OutputRoot = "C:\CoworkMemory\tsp-proposals",
  [string]$ConfigPath = "",
  [string]$TopicsPath = (Join-Path $PSScriptRoot "topics.json"),
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Write-Log {
  param([string]$Message, [string]$Level = "INFO")
  Write-Host ("[{0}] {1,-5} {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Message)
}

# ---------------------------------------------------------------- configuration
# Resolved here rather than in param() so the default stays Windows PowerShell 5.1 safe.
if (-not $ConfigPath) {
  $userRoot = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  $ConfigPath = Join-Path $userRoot ".cowork-memory/config.json"
}

$cfg = @{ host = $null; port = 8377; apiKey = $null }

if (Test-Path -LiteralPath $ConfigPath) {
  try {
    $fromFile = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    foreach ($k in @("host", "port", "apiKey")) {
      if ($fromFile.PSObject.Properties.Name -contains $k -and $fromFile.$k) { $cfg[$k] = $fromFile.$k }
    }
    Write-Log "Loaded config from $ConfigPath"
  } catch {
    Write-Log "Could not parse $ConfigPath ($($_.Exception.Message)) - falling back to environment" "WARN"
  }
} else {
  Write-Log "No config file at $ConfigPath - using environment variables" "WARN"
}

if ($env:MEMORY_HOST)    { $cfg.host   = $env:MEMORY_HOST }
if ($env:MEMORY_PORT)    { $cfg.port   = [int]$env:MEMORY_PORT }
if ($env:MEMORY_API_KEY) { $cfg.apiKey = $env:MEMORY_API_KEY }

if (-not $cfg.host) {
  throw "Memory host is not configured. Set MEMORY_HOST or add `"host`" to $ConfigPath."
}

$baseUrl = "http://$($cfg.host):$($cfg.port)"
$headers = @{ "Content-Type" = "application/json" }
if ($cfg.apiKey) { $headers["X-Api-Key"] = $cfg.apiKey }

Write-Log "Memory brain: $baseUrl"
Write-Log "Cowork folder: $OutputRoot"

# ------------------------------------------------------------------- utilities
function Get-SafeName {
  param([string]$Value)
  $clean = $Value -replace '[\\/:*?"<>|]', '-'
  $clean = $clean -replace '\s+', ' '
  return $clean.Trim()
}

function Format-Updated {
  param($Value)
  if ($null -eq $Value) { return "unknown" }
  if ($Value -is [datetime]) { return $Value.ToString("yyyy-MM-dd") }
  $parsed = [datetime]::MinValue
  if ([datetime]::TryParse([string]$Value, [ref]$parsed)) { return $parsed.ToString("yyyy-MM-dd") }
  return [string]$Value
}

function Write-StaleMarker {
  param([string]$Root, [string]$Reason)
  if (-not (Test-Path -LiteralPath $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
  $stalePath = Join-Path $Root "_STALE.md"
  @(
    "# Snapshot is STALE"
    ""
    "The last refresh attempt FAILED, so the files in this folder are older than they look."
    ""
    "- Attempted: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))"
    "- Reason: $Reason"
    ""
    "Treat every fact in this folder as unverified until this file disappears."
    "Check that Tailscale is connected and the memory service is running on HQ."
  ) -join "`r`n" | Set-Content -LiteralPath $stalePath -Encoding UTF8
  Write-Log "Wrote stale marker to $stalePath" "WARN"
}

# ------------------------------------------------------------------ preflight
try {
  $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -Headers $headers -TimeoutSec 15
  if (-not $health.ok) { throw "health endpoint did not return ok" }
  Write-Log "Health check passed ($($health.service))"
} catch {
  $reason = "Cannot reach $baseUrl/health - $($_.Exception.Message)"
  Write-Log $reason "ERROR"
  Write-StaleMarker -Root $OutputRoot -Reason $reason
  exit 1
}

# --------------------------------------------------------------------- topics
if (-not (Test-Path -LiteralPath $TopicsPath)) { throw "Topics file not found: $TopicsPath" }
$topicsCfg = Get-Content -LiteralPath $TopicsPath -Raw | ConvertFrom-Json
$policy = $topicsCfg.policy
$defaultK = [int]$topicsCfg.defaultK
$maxChars = [int]$topicsCfg.maxCharsPerDoc

# Stage into a temp folder; only swap in on success so Cowork never reads a half-write.
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("tsp-memory-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$summary = @()
$okCount = 0
$allSources = New-Object System.Collections.Generic.HashSet[string]

foreach ($topic in $topicsCfg.topics) {
  $k = $defaultK
  if ($topic.PSObject.Properties.Name -contains "k" -and $topic.k) { $k = [int]$topic.k }

  $payload = @{ query = $topic.query; k = $k }
  if ($policy) { $payload["policy"] = $policy }
  $body = $payload | ConvertTo-Json -Depth 5 -Compress

  try {
    Write-Log "Querying '$($topic.slug)' (k=$k)"
    $resp = Invoke-RestMethod -Uri "$baseUrl/search" -Method Post -Headers $headers -Body $body -TimeoutSec $TimeoutSec
    $hits = @($resp.hits)

    # Group chunks back into their source documents so Cowork reads prose, not fragments.
    $byDoc = [ordered]@{}
    foreach ($hit in $hits) {
      $path = [string]$hit.chunk.notePath
      if (-not $byDoc.Contains($path)) {
        $byDoc[$path] = [pscustomobject]@{
          NotePath = $path
          Source   = [string]$hit.chunk.source
          Updated  = (Format-Updated $hit.chunk.updated)
          Score    = [double]$hit.score
          Texts    = New-Object System.Collections.Generic.List[string]
        }
      }
      $byDoc[$path].Texts.Add([string]$hit.chunk.text)
      [void]$allSources.Add($path)
    }

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("# $($topic.title)")
    $lines.Add("")
    $lines.Add("> Retrieved from the Agent-Memory brain on $((Get-Date).ToString('yyyy-MM-dd HH:mm')) using policy ``$policy``.")
    $lines.Add("> Query: *$($topic.query)*")
    $lines.Add("> $($hits.Count) chunks across $($byDoc.Count) source documents.")
    $lines.Add("")

    foreach ($key in $byDoc.Keys) {
      $doc = $byDoc[$key]
      $text = ($doc.Texts -join "`r`n`r`n")
      if ($text.Length -gt $maxChars) { $text = $text.Substring(0, $maxChars) + "`r`n`r`n*[truncated]*" }
      $lines.Add("## $($doc.NotePath)")
      $lines.Add("")
      $lines.Add("*source: $($doc.Source) | updated: $($doc.Updated) | score: $([math]::Round($doc.Score, 4))*")
      $lines.Add("")
      $lines.Add($text)
      $lines.Add("")
      $lines.Add("---")
      $lines.Add("")
    }

    $outFile = Join-Path $staging ("{0}.md" -f (Get-SafeName $topic.slug))
    ($lines -join "`r`n") | Set-Content -LiteralPath $outFile -Encoding UTF8

    $summary += [pscustomobject]@{ Slug = $topic.slug; Title = $topic.title; Hits = $hits.Count; Docs = $byDoc.Count; Ok = $true; Error = "" }
    $okCount++
    Write-Log "  -> $($hits.Count) chunks / $($byDoc.Count) docs"
  } catch {
    $msg = $_.Exception.Message
    Write-Log "  -> FAILED: $msg" "ERROR"
    $summary += [pscustomobject]@{ Slug = $topic.slug; Title = $topic.title; Hits = 0; Docs = 0; Ok = $false; Error = $msg }
  }
}

if ($okCount -eq 0) {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  $reason = "All $($topicsCfg.topics.Count) topic queries failed."
  Write-Log $reason "ERROR"
  Write-StaleMarker -Root $OutputRoot -Reason $reason
  exit 1
}

# ------------------------------------------------------------------- manifest
$generated = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
$idx = New-Object System.Collections.Generic.List[string]
$idx.Add("# TSP proposal memory - snapshot")
$idx.Add("")
$idx.Add("**Generated:** $generated")
$idx.Add("**Source:** Agent-Memory brain at $baseUrl (Obsidian vault + ingested proposal corpus)")
$idx.Add("**Retrieval policy:** ``$policy``")
$idx.Add("")
$idx.Add("This is a point-in-time snapshot, not a live query. If the generated timestamp above is")
$idx.Add("more than a few days old, say so before relying on it.")
$idx.Add("")
$idx.Add("## Files")
$idx.Add("")
$idx.Add("| File | Topic | Chunks | Source docs | Status |")
$idx.Add("|---|---|---|---|---|")
foreach ($row in $summary) {
  $status = if ($row.Ok) { "ok" } else { "FAILED: $($row.Error)" }
  $idx.Add("| ``$($row.Slug).md`` | $($row.Title) | $($row.Hits) | $($row.Docs) | $status |")
}
$idx.Add("")
$idx.Add("## Source documents in this snapshot ($($allSources.Count))")
$idx.Add("")
foreach ($s in ($allSources | Sort-Object)) { $idx.Add("- $s") }
$idx.Add("")
($idx -join "`r`n") | Set-Content -LiteralPath (Join-Path $staging "_index.md") -Encoding UTF8

$statusObj = [ordered]@{
  generatedAt  = (Get-Date).ToUniversalTime().ToString("o")
  baseUrl      = $baseUrl
  policy       = $policy
  topicsOk     = $okCount
  topicsTotal  = @($topicsCfg.topics).Count
  sourceDocs   = $allSources.Count
  topics       = $summary
}
($statusObj | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath (Join-Path $staging "_status.json") -Encoding UTF8

# ----------------------------------------------------------------- swap in
if (-not (Test-Path -LiteralPath $OutputRoot)) { New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null }
Get-ChildItem -LiteralPath $OutputRoot -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "*.md" -or $_.Name -eq "_status.json" } |
  Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $staging -File | ForEach-Object {
  Move-Item -LiteralPath $_.FullName -Destination (Join-Path $OutputRoot $_.Name) -Force
}
Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue

Write-Log "Snapshot written: $okCount/$(@($topicsCfg.topics).Count) topics, $($allSources.Count) source documents"
if ($okCount -lt @($topicsCfg.topics).Count) { Write-Log "Some topics failed - see _index.md" "WARN"; exit 2 }
exit 0

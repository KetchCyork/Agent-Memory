# Proposal memory refresh

Keeps the Agent-Memory brain current with the SharePoint/OneDrive proposal folder,
so drafts are grounded in recent firm precedent rather than a frozen corpus.

## Why this exists

On 2026-09-18 every chunk in the index was dated **2026-07-04** — a single bulk
ingest, 76 days earlier, with nothing since. The corpus wasn't just stale at the
edges; it was stale end to end.

That matters more than it first looks. Two things go out of date independently:

| Layer | Refresh | Notes |
|---|---|---|
| SharePoint → brain | **this folder**, weekly | the corpus itself |
| brain → Cowork snapshot | `../cowork-bridge`, daily | a view of the corpus |

Making the Cowork side "live" would fix nothing while the brain is months behind —
it would just serve old proposals faster. The brain is the thing that has to move.

## How it works

```
tspusl098 (Windows)                          HQ MacBook
SharePoint/OneDrive proposals
        │
        ▼
refresh-proposal-memory.ps1  ──tailnet──►  POST /ingest  ──►  LanceDB
  (weekly Scheduled Task)                  (X-Api-Key)
```

Push-only, by necessity: corporate endpoint protection blocks inbound TCP to the
work laptop, so HQ can never pull from it. Every run is initiated locally.

**Re-ingest is idempotent.** The brain's `putNoteChunks()` deletes every row for a
`notePath` before re-adding it, so a full pass replaces documents rather than
duplicating them. Running this twice in a row is harmless.

## Install on tspusl098

**1. Copy this folder** to the work laptop, e.g. `C:\CoworkMemory\proposal-refresh\`.

**2. Extend the shared config.** This reuses the same file as the Cowork bridge —
one key, one place. Add the two new fields:

```powershell
$cfg = "$env:USERPROFILE\.cowork-memory\config.json"
@{
  host         = "100.74.9.120"
  port         = 8377
  apiKey       = "<MEMORY_API_KEY from agent-memory-mesh/.env on HQ>"
  proposalPath = "C:\Users\cyork\OneDrive - TSP\Proposals"   # your actual synced path
  ingestRepo   = "C:\Users\cyork\Agent-OS\Agent-proposal-ingestion"
} | ConvertTo-Json | Set-Content $cfg
```

**3. Fix the ingestion repo's own key.** `Agent-proposal-ingestion\.env` has an
empty `MEMORY_API_KEY`, which returns 401 on every call now that the brain is
authenticated. Set it to the same value. The refresh script refuses to start
until you do, rather than burning hours on a run that 401s all the way through.

**4. Dry run first** — no ingest, just a census of what it sees:

```powershell
powershell -ExecutionPolicy Bypass -File .\refresh-proposal-memory.ps1 -WhatIfOnly
```

Check the file count looks right. A count of 0 usually means OneDrive isn't
synced or `proposalPath` is wrong.

**5. Run it once for real**, and note how long it takes:

```powershell
powershell -ExecutionPolicy Bypass -File .\refresh-proposal-memory.ps1
```

**6. Schedule it:**

```powershell
powershell -ExecutionPolicy Bypass -File .\install-ingest-task.ps1
```

Mondays 06:00, with `StartWhenAvailable` so a missed run (laptop off or off the
network) fires when the machine is next usable instead of waiting a week.
`-DayOfWeek` and `-At` change the slot; `-Uninstall` removes it.

## Files

| File | Purpose |
|---|---|
| `refresh-proposal-memory.ps1` | Preflight, ingest, verify, log |
| `install-ingest-task.ps1` | Registers/removes the weekly task |

## Behaviour

- **Preflight before the long part.** Checks the proposal folder exists, the
  ingest repo exists, its `MEMORY_API_KEY` is non-empty and matches the shared
  config, and the brain answers `/health` — all before starting a multi-hour run.
- **Post-ingest verification.** Queries the brain and reports the freshest chunk
  date, so a run that silently ingested nothing can't look like success.
- **Duration is logged every run.** A full pass re-embeds the corpus (2,867
  documents / ~112k chunks as of the July baseline). If that number creeps toward
  the weekly window, that's the signal to add incremental ingest — see below.
- **Logs:** `%USERPROFILE%\.cowork-memory\logs\proposal-refresh-<date>.log`, plus
  `ingest-stdout.log` / `ingest-stderr.log` from the CLI itself.
- **Exit codes:** 0 success, non-zero on preflight failure or a failed ingest.
  `Get-ScheduledTaskInfo -TaskName "Proposal Memory Refresh"` surfaces the last one.

## If the weekly run gets too slow

The obvious optimisation is to ingest only files whose mtime changed since the
last run, staged into a temp folder. That was deliberately **not** built yet,
because it depends on how `ingest-remote` derives `notePath`: if the path is
relative to the directory you hand it, staging preserves identity and updates
cleanly; if it's derived any other way, staged files would land under new
notePaths and *duplicate* the corpus instead of replacing it.

Verify that before optimising — ingest one known file from a staging folder and
check whether its `notePath` in the brain matches the original.

## Governance note

This puts a recurring, automated read of corporate SharePoint data on a timer.
That narrows the standing "corporate data stays on-demand" rule, scoped to the
proposal corpus only. Chris approved it explicitly on 2026-09-19. The Outlook /
mail guardrail is untouched and still on-demand only.

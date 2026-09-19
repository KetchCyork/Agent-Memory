# Cowork bridge — TSP proposal memory

Connects the Agent-Memory brain (HQ MacBook, `100.74.9.120:8377`) to **Claude Cowork** on
the Windows work laptop (`tspusl098`).

## Why it works this way

Cowork's custom connectors dial out from **Anthropic's cloud**, not from the laptop — so a
tailnet-only service is invisible to them, even though `tspusl098` is on the tailnet and
can `curl` the endpoint today. Cowork also doesn't support local stdio MCP servers.

What Cowork *can* do is read local files and load custom Skills. So the bridge is:

```
HQ MacBook                     tspusl098 (Windows)
Agent-Memory :8377  ──tailnet──►  pull-tsp-memory.ps1
(LanceDB + vault)                      │
                                       ▼
                             C:\CoworkMemory\tsp-proposals\   ──►  Cowork (folder)
                             tsp-proposals skill (ZIP)        ──►  Cowork (skill)
```

Tradeoff: scheduled snapshot, not live retrieval. The style profile and drafting rules live
in the Skill (always loaded); the retrieved proposal corpus lives in the folder.

This keeps Cowork current with the *brain*. Keeping the brain current with
SharePoint is a separate job — see `../proposal-refresh`. A fresh snapshot of a
stale corpus is still stale.

## Install on tspusl098

### Before you run anything

Open a **normal** PowerShell window (no admin needed), then once per session:

```powershell
cd "<the folder you extracted, e.g. $env:USERPROFILE\Downloads\windows-memory-setup\cowork-bridge>"
Get-ChildItem -Recurse | Unblock-File                          # clears the downloaded-file flag
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force   # this window only
```

`Unblock-File` is not optional for files that arrived by taildrop, email or
browser download — PowerShell blocks them on Mark-of-the-Web regardless of
execution policy.

After that, run the scripts directly: `.\setup-config.ps1`. The
`powershell -ExecutionPolicy Bypass -File ...` form below is for a **cmd**
prompt or a scheduled task; pasting it *into* PowerShell fails, because
PowerShell reads `-ExecutionPolicy` as a command name.

**1. Copy this folder** to the work laptop, e.g. `C:\CoworkMemory\bridge\`.

**2. Write the config** (keeps the API key out of the script and out of git):

```powershell
mkdir "$env:USERPROFILE\.cowork-memory" -Force
@{ host = "100.74.9.120"; port = 8377; apiKey = "<MEMORY_API_KEY from agent-memory-mesh/.env>" } |
  ConvertTo-Json | Set-Content "$env:USERPROFILE\.cowork-memory\config.json"
```

`../proposal-refresh` shares this file and adds `proposalPath` and `ingestRepo`
to it — one key in one place. If you are installing both, write the config once
with all five fields (see that README) rather than overwriting it here.

**3. Run it once:**

```powershell
powershell -ExecutionPolicy Bypass -File .\pull-tsp-memory.ps1
```

Expect `Snapshot written: 7/7 topics, ~49 source documents` and files in
`C:\CoworkMemory\tsp-proposals\`.

**4. Schedule it:**

```powershell
powershell -ExecutionPolicy Bypass -File .\install-task.ps1
```

Weekdays at 07:30, plus 2 minutes after logon. `-Uninstall` removes it.

**5. Upload the Skill.** In Cowork: Skills → upload `tsp-proposals-skill.zip`.

**6. Set folder instructions.** Point Cowork at your proposal working folder and paste in
`cowork-folder-instructions.md`.

## Files

| File | Purpose |
|---|---|
| `pull-tsp-memory.ps1` | Queries the brain, writes the markdown snapshot. Fail-soft. |
| `topics.json` | The seven retrieval slices. Edit to change what gets pulled. |
| `install-task.ps1` | Registers/removes the Windows scheduled task. |
| `cowork-folder-instructions.md` | Paste into Cowork's folder instructions. |
| `skill/tsp-proposals/` | The Skill source (style profile, template, lessons). |
| `tsp-proposals-skill.zip` | Built Skill, ready to upload. |

## Behaviour notes

- **Fail-soft.** If the brain is unreachable, the previous snapshot is left in place and
  `_STALE.md` is written, so Cowork sees staleness rather than an empty folder. The marker
  clears automatically on the next successful run. Exit code 1 on total failure, 2 if some
  topics failed, 0 on success.
- **Atomic swap.** Files are staged in temp and moved in only after at least one topic
  succeeds — Cowork never reads a half-written folder.
- **Rebuilding the skill ZIP** after editing `skill/tsp-proposals/`:
  `cd skill && zip -r ../tsp-proposals-skill.zip tsp-proposals`

## Editing what gets pulled

`topics.json` drives everything. Each topic is a query against the `proposal-drafting`
retrieval policy, written out as one markdown file. Add a topic, rerun, done.

## Data note

The snapshot contains excerpts from named client engagements (Lakeland, NYRA, SMUD,
Mammoth Brands, Progressive Produce, Supernal, A. Stucki). This moves client material
*back onto* the work laptop, which is the right direction — but it's why
`cowork-folder-instructions.md` carries an explicit cross-client confidentiality rule.
Keep that rule in place.

# Memory

The single most important design decision in this project. The goal: the system
"truly knows" you — your email style, your writing style, your proposals — and can
serve that knowledge to **any** model (Claude, GLM, Kimi, a local model), not just one.

## The core idea

Memory must live **outside** the models. No model can see your files, and pasting a
whole vault into a prompt neither scales nor works across models with different
context windows. So memory is an external system with three layers. Each model is
fed only the relevant slice at call time — which is exactly why the same memory works
for every model.

## Layer 1 — Store of record (Obsidian vault)

Plain Markdown with YAML frontmatter. Durable, human-readable, yours forever,
git-versionable. This is the source of truth; everything else is rebuildable from it.

Folder layout (`vault-template/`):

```
10-Profiles/     # who you are + how you write  (always-on context)
  bio.md
  email-style.md
  writing-style.md
  proposals-style.md
20-Projects/     # one note per active project
30-Knowledge/    # reference material, research, facts
40-Logs/         # daily logs (YYYY-MM-DD.md), auto-appended
50-Pipeline/     # idea -> approve -> build items (see Pipeline module)
90-Generated/    # drafts the system produced, for review
```

Every note carries frontmatter so it can be filtered and routed:

```yaml
---
type: project | knowledge | log | profile | pipeline-item | generated
title: ...
tags: [seo, proposal, sap]
source: manual | onedrive | outlook | omi
created: 2026-06-18T09:00:00Z
updated: 2026-06-18T09:00:00Z
confidence: 0.9        # optional, for machine-generated notes
---
```

## Layer 2 — Retrieval index (what makes memory usable by every model)

A local vector index built from the vault (and opt-in sources like your OneDrive
proposal directory and Outlook).

- **Chunk** notes into passages.
- **Embed** them **locally** with Ollama (`nomic-embed-text`) — free, and nothing
  leaves your machine.
- **Store** vectors in a local file-based index (rebuildable any time; disposable).
- At query time, **semantic search** returns the top-k relevant chunks.

This is the answer to "is Obsidian enough across all models?" — Obsidian holds the
text; the index makes it retrievable; retrieval is model-independent.

## Layer 3 — Context assembler

For each task, assemble a bounded context bundle and hand it to the target model:

1. **Always-on profile** — short summaries from `10-Profiles/` (your styles, bio).
2. **Retrieved chunks** — top-k from the index for this task.
3. **Recent logs** — the last few daily logs for continuity.

The assembler enforces a token budget and formats for the specific model being called
(a 1M-context model gets more; a small local model gets less).

## Learning your styles

Point the indexer at your OneDrive proposal directory. It will:

1. Ingest the proposal documents (read-only).
2. Extract recurring structure, tone, section patterns, and boilerplate into
   `10-Profiles/proposals-style.md`.
3. Index the originals so drafting can retrieve your real templates.

The same approach builds `email-style.md` and `writing-style.md` from samples you
point it at. Drafting a new proposal then = your style profile + your closest existing
templates + the new brief, fed to your chosen model.

## Pluggable sources (you are never forced to buy hardware)

- **Obsidian** — required, the store of record.
- **OneDrive** — optional, via the Microsoft 365 connector (proposals, docs).
- **Outlook / Teams** — optional, for awareness + style learning.
- **Omi (or any wearable)** — optional. The reference video uses Omi for conversation
  memories; it is strictly optional here.

## Privacy

- Embeddings are computed locally (Ollama). Private/work content can be indexed
  without sending it to any cloud model.
- You choose what gets indexed. Work-machine sources stay on the work machine.
- The cloud models only ever see the small, relevant slices the assembler sends,
  and only when you choose a cloud model for that task.

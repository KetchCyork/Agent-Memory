# agent-memory-mesh

A shared, local-first **memory brain for AI agents** — one knowledge layer that
every agent on every machine can read and write. Obsidian is the durable store;
LanceDB provides hybrid (semantic + keyword) retrieval; embeddings run locally via
Ollama; and the brain is served over **HTTP and MCP** across a **Tailscale** mesh.

> **Privacy guarantee:** raw vault content never leaves your local machines.
> Cloud models (Claude, GPT, etc.) only receive the small relevant context slice
> assembled by the retrieval engine.

---

## Table of contents

1. [Why](#why)
2. [Architecture](#architecture)
3. [Quickstart](#quickstart)
4. [Configuration](#configuration)
5. [Memory subsystems](#memory-subsystems)
6. [HTTP API reference](#http-api-reference)
7. [MCP tools reference](#mcp-tools-reference)
8. [CLI commands](#cli-commands)
9. [Tailscale mesh setup](#tailscale-mesh-setup)
10. [Extending the brain](#extending-the-brain)

---

## Why

Agents forget. Pasting whole vaults into prompts doesn't scale and doesn't work
across models or machines. The fix is to keep memory **outside** the models and
let each agent retrieve only the relevant slice at query time — so the same brain
serves Claude, a local model, Hermes, anything.

Key design decisions:

- **Local embeddings.** `nomic-embed-text` runs in Ollama. Nothing reaches a cloud
  embedding API.
- **Hybrid retrieval.** Vector similarity + BM25 keyword search fused with RRF.
  Better recall than either alone.
- **Human approval before writes.** No tool auto-sends mail, files proposals, or
  modifies shared systems without an explicit approval gate.
- **TypeScript throughout.** No Python services in the memory layer.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Tailscale mesh                               │
│                                                                     │
│   MacBook HQ          Windows laptop         MacBook 2017/Linux     │
│   ┌───────────┐       ┌────────────┐         ┌──────────────────┐  │
│   │ HTTP/MCP  │◄─────►│ mesh runner│◄────────►│ mesh runner      │  │
│   │ :8377     │       │ /invoke    │         │ /invoke          │  │
│   └─────┬─────┘       └────────────┘         └──────────────────┘  │
│         │                                                           │
│   ┌─────▼──────────────────────────────────────────────────────┐   │
│   │              agent-memory-mesh (this repo)                  │   │
│   │                                                             │   │
│   │  MemoryEngine                                               │   │
│   │   ├─ Embedder (Ollama / nomic-embed-text)                  │   │
│   │   ├─ MemoryStore (LanceDB hybrid retrieval)                 │   │
│   │   ├─ WorkMemoryStore (episodic action log)                  │   │
│   │   ├─ Consolidator (session → vault lesson notes)            │   │
│   │   ├─ ContextGraph (entities + edges + wiki summaries)       │   │
│   │   ├─ RetrievalPolicyStore (named search presets)            │   │
│   │   ├─ FeedbackStore (upvote/downvote retrieval scoring)      │   │
│   │   ├─ NodeRegistry (mesh node discovery + heartbeat)         │   │
│   │   ├─ HooksEngine (rules-based alerting)                     │   │
│   │   ├─ SnapshotStore (state versioning + restore)             │   │
│   │   ├─ ScoringStore (per-note decay scoring)                  │   │
│   │   └─ ProvenanceStore (ingestion traceability)               │   │
│   │                                                             │   │
│   │  Connectors                                                 │   │
│   │   └─ OneDriveConnector (Microsoft Graph API)                │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│   Obsidian vault (durable store)   LanceDB index (retrieval)        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quickstart

### Prerequisites

- Node.js 18+
- [Ollama](https://ollama.com) running locally
- An Obsidian vault (or any folder of Markdown files)

### Install and run

```bash
cd agent-memory-mesh
cp .env.example .env        # edit VAULT_PATH at minimum
npm install
ollama pull nomic-embed-text
npm run index               # build the retrieval index from your vault
npm run serve               # HTTP API on http://127.0.0.1:8377
```

To expose to other machines on your Tailscale mesh:

```bash
MEMORY_HOST=your-tailnet-name npm run serve
```

To run as an MCP server (for Claude Code or any MCP-capable agent on the same machine):

```bash
npm run serve:mcp
```

### First query

```bash
curl -s http://127.0.0.1:8377/health
# → {"ok":true,"service":"agent-memory-mesh"}

curl -s -X POST http://127.0.0.1:8377/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"proposal drafting process","k":5}'
```

---

## Configuration

All config is read from environment variables (or a `.env` file via `dotenv`).

| Variable | Default | Description |
|---|---|---|
| `VAULT_PATH` | `~/.agent-memory-mesh/vault` | Path to your Obsidian vault or Markdown folder |
| `MEMORY_DB_PATH` | `~/.agent-memory-mesh/memory.lancedb` | LanceDB index location |
| `WORK_MEMORY_PATH` | `~/.agent-memory-mesh/work-memory.json` | Episodic work memory log |
| `GRAPH_PATH` | `~/.agent-memory-mesh/context-graph.json` | Context graph state |
| `POLICIES_PATH` | `~/.agent-memory-mesh/retrieval-policies.json` | Custom retrieval policies |
| `FEEDBACK_PATH` | `~/.agent-memory-mesh/feedback.json` | Feedback signals |
| `SCORING_PATH` | `~/.agent-memory-mesh/scoring.json` | Per-note access scores |
| `PROVENANCE_PATH` | `~/.agent-memory-mesh/provenance.json` | Ingestion provenance records |
| `SNAPSHOTS_DIR` | `~/.agent-memory-mesh/snapshots` | Memory state snapshot directory |
| `HOOKS_STATE_PATH` | `~/.agent-memory-mesh/hooks.json` | Alert rules and fire history |
| `NODE_REGISTRY_PATH` | `~/.agent-memory-mesh/node-registry.json` | Mesh node registry |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `EMBED_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `CONSOLIDATION_MODEL` | _(empty)_ | Ollama model for LLM-based session synthesis (optional; rule-based if empty) |
| `MEMORY_HOST` | `127.0.0.1` | Bind address. Set to your Tailscale node name to share over the mesh |
| `MEMORY_PORT` | `8377` | HTTP port |
| `MEMORY_API_KEY` | _(empty)_ | Shared secret for `X-Api-Key` auth (optional) |

---

## Memory subsystems

### Vault + Index (`src/memory/vault.ts`, `indexer.ts`, `store.ts`)

The vault is a folder of Markdown files. The indexer walks every `.md` file,
chunks them by heading and paragraph, embeds each chunk locally via Ollama, and
stores the vectors alongside BM25 metadata in LanceDB.

```bash
npm run index          # full rebuild
npm run index -- --watch  # watch for changes (if implemented)
```

The retrieval store fuses vector similarity with keyword search using Reciprocal
Rank Fusion (RRF), giving better recall than either method alone.

---

### Work Memory (`src/memory/work-memory.ts`)

An episodic log of agent actions, outputs, corrections, and signals. Every agent
action should be recorded here so the brain can learn from experience.

**Entry types:** `action`, `output`, `correction`, `signal`, `search`

Each entry carries: `sessionId`, `type`, `summary`, optional `command`, `args`,
`result`, `success`, `taskId`, `agentId`, `tags`.

Corrections are linked entries that record what went wrong and what the correct
approach is. They feed the self-improvement loop during consolidation.

---

### Consolidator (`src/memory/consolidator.ts`)

Synthesises work memory sessions into concise lesson notes written to the vault
(`vault/10-inbox/`). Lessons are structured Markdown with YAML frontmatter.

If `CONSOLIDATION_MODEL` is set, uses the Ollama LLM for richer synthesis.
Otherwise uses a rule-based approach that summarises success/failure/correction
counts and lists entry summaries.

Lessons are idempotent — re-consolidating the same session overwrites the same
file rather than creating duplicates.

---

### Context Graph (`src/memory/context-graph.ts`)

A local knowledge graph of entities (projects, people, documents, connectors,
concepts) and typed edges between them. Each entity can have a wiki summary — a
compact description built either by a local LLM or rule-based summarisation.

Wiki summaries are injected alongside retrieval hits when a retrieval policy has
`includeWiki: true`, giving agents structured entity context without large context
usage.

---

### Retrieval Policies (`src/memory/retrieval-policy.ts`)

Named search presets that control `k`, metadata filters, recency boost, and wiki
preloading. Built-in policies:

| Policy | Description |
|---|---|
| `default` | Balanced retrieval, no boost |
| `proposal-drafting` | Higher `k`, includes wiki |
| `research` | Large `k`, recency boosted |
| `email-context` | Small `k`, recent emphasis |

Custom policies can be added via the API and persist across restarts.

---

### Feedback Loop (`src/memory/feedback.ts`)

Upvote/downvote signals per vault note, stored as a JSON signal log. The retrieval
engine applies feedback scoring to re-rank results — upvoted notes score higher,
downvoted notes score lower.

The `processCorrections()` engine method converts work memory correction entries
(entries with `args.notePaths`) into automatic downvote signals, closing the
self-improvement loop.

---

### Scoring + Cache (`src/memory/scoring.ts`)

Per-note access scoring with optional exponential decay. Each search hit that is
returned increments the note's access count and resets its score to 1.0. Decay
is applied at read time:

```
score = 1.0 × 0.5^(daysSinceAccess / halfLifeDays)
```

The LRU search cache (`src/memory/cache.ts`) stores recent query results in memory
with a configurable TTL and maximum size, avoiding redundant embedding round-trips
for repeated queries.

---

### Provenance (`src/memory/provenance.ts`)

Every ingested chunk can carry a provenance record: where it came from, when it
was ingested, by which agent/session, and from which remote node. Supports
filtering by remote node ID to audit what a specific mesh runner has contributed.

Provenance sources: `vault`, `indexer`, `work-memory`, `remote`, `manual`.

---

### Snapshots (`src/memory/snapshots.ts`)

Point-in-time copies of work memory, context graph, and feedback state. A safety
snapshot is automatically created before any restore operation.

```bash
# Create a snapshot before a risky experiment
POST /snapshots  {"label": "before-experiment"}

# Restore to a known good state
POST /snapshots/:id/restore
```

---

### Node Registry (`src/memory/node-registry.ts`)

A registry of mesh runner nodes connected to this memory service. Each node
declares its Tailscale address and capability list (e.g. `m365`, `shell`,
`local-model`). Registration is idempotent — re-registering by name updates
the record in place.

Nodes send heartbeats to stay marked `online`. Nodes that fail to heartbeat can
be explicitly deregistered (marked `offline`) or hard-removed.

---

### Hooks Engine (`src/memory/hooks.ts`)

Rules-based alerting: fire a configured action when a memory event occurs.

**Events:** `search`, `reindex`, `work-memory`, `consolidation`, `feedback`

**Conditions:**
- `minLatencyMs` — only fire when an operation took at least N ms (useful for slow-query alerts)
- `onError` — only fire when the operation encountered an error
- `pattern` — only fire when the event payload matches a regex

**Actions:** `log` (writes to stderr). Additional actions (webhook, etc.) can be
added by extending `HooksEngine.dispatch()`.

---

### OneDrive Connector (`src/connectors/onedrive.ts`)

Microsoft Graph API client for listing and reading OneDrive files. Requires a
delegated access token with `Files.Read` scope (MSAL PKCE flow, separate from
this service — obtain from the `o365 plugin`).

The connector returns raw file metadata. It does **not** auto-index or auto-write.
Files must be explicitly queued for human-approved ingestion.

```typescript
const connector = new OneDriveConnector(accessToken);
const listing = await connector.listItems("me", null);       // root
const files   = await connector.listFilesRecursive("me", null, 3); // recursive, max depth 3
```

---

## HTTP API reference

All endpoints accept and return JSON. Set `Content-Type: application/json` on
POST/PATCH bodies. If `MEMORY_API_KEY` is set, include `X-Api-Key: <key>` on
every request.

### Core

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET` | `/health` | — | `{ok, service}` |
| `POST` | `/search` | `{query, k?, filter?, policy?}` | `{hits}` or `{hits, wikis, policy}` |
| `POST` | `/reindex` | `{}` | `{notes, chunks}` |

### Work Memory

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `POST` | `/work-memory` | `{sessionId, type, summary, ...}` | `{entry}` 201 |
| `GET` | `/work-memory` | `?sessionId&type&agentId&since&limit` | `{entries}` |
| `POST` | `/work-memory/correction` | `{sessionId, note, sourceEntryId?}` | `{entry}` 201 |
| `GET` | `/work-memory/session/:id` | — | `{entries}` |

### Consolidation

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/consolidate` | `{}` | `{results: ConsolidationResult[]}` |
| `POST` | `/consolidate/:sessionId` | `{}` | `{result: ConsolidationResult}` |

### Context Graph

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `POST` | `/graph/entities` | `{name, type, description?, tags?, id?}` | `{entity}` 201 |
| `GET` | `/graph/entities` | `?type=&name=` | `{entities}` |
| `GET` | `/graph/entities/:id` | — | `{entity, edges, neighbors}` |
| `DELETE` | `/graph/entities/:id` | — | `{ok}` |
| `POST` | `/graph/edges` | `{fromId, toId, relation, weight?}` | `{edge}` 201 |
| `DELETE` | `/graph/edges/:id` | — | `{ok}` |
| `GET` | `/graph/entities/:id/neighbors` | — | `{neighbors}` |
| `POST` | `/graph/wiki/:id` | `{}` | `{entity}` |

### Retrieval Policies

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/policies` | — | `{policies}` |
| `POST` | `/policies` | `{name, k, filter?, boostRecent?, ...}` | `{policy}` 201 |
| `DELETE` | `/policies/:name` | — | `{ok}` |
| `POST` | `/wiki/preload` | `{query?, entityIds?, limit?}` | `{wikis}` |

### Feedback

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `POST` | `/feedback/upvote` | `{notePath, sessionId?, query?, note?}` | `{signal}` 201 |
| `POST` | `/feedback/downvote` | `{notePath, sessionId?, query?, note?}` | `{signal}` 201 |
| `POST` | `/feedback/process` | `{}` | `{processed, signals}` |
| `GET` | `/feedback/signals` | `?notePath=` | `{signals}` |
| `GET` | `/feedback/summary` | — | `{topUpvoted, topDownvoted, totalSignals}` |

### Metrics

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/metrics` | — | `{metrics: MetricsSnapshot}` |
| `POST` | `/metrics/reset` | `{}` | `{ok}` |

`MetricsSnapshot` fields: `searchCount`, `searchErrors`, `totalSearchLatencyMs`,
`avgSearchLatencyMs`, `indexCount`, `indexErrors`, `totalIndexLatencyMs`,
`workMemoryCount`, `consolidationCount`, `feedbackCount`, `uptimeMs`, `startedAt`.

### Snapshots

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/snapshots` | `{label?}` | `{manifest}` 201 |
| `GET` | `/snapshots` | — | `{snapshots}` |
| `GET` | `/snapshots/:id` | — | `{manifest}` |
| `DELETE` | `/snapshots/:id` | — | `{ok}` |
| `POST` | `/snapshots/:id/restore` | `{}` | `{ok}` |

### Inspect

| Method | Path | Returns |
|---|---|---|
| `GET` | `/inspect/stats` | `{stats: {workMemory, graph, feedback, policies, hooks}}` |

### Hooks

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET` | `/hooks` | — | `{rules}` |
| `POST` | `/hooks` | `{name, event, action, condition?, enabled?}` | `{rule}` 201 |
| `GET` | `/hooks/:id` | — | `{rule}` |
| `PATCH` | `/hooks/:id` | `{enabled?, condition?, ...}` | `{rule}` |
| `DELETE` | `/hooks/:id` | — | `{ok}` |
| `GET` | `/hooks/:id/history` | — | `{history}` |

### Node Registry

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `POST` | `/nodes/register` | `{name, address, capabilities, metadata?}` | `{node}` 201 |
| `GET` | `/nodes` | `?status=&capability=` | `{nodes}` |
| `GET` | `/nodes/:id` | — | `{node}` |
| `DELETE` | `/nodes/:id` | — | `{ok}` |
| `POST` | `/nodes/:id/heartbeat` | `{}` | `{ok}` |
| `POST` | `/nodes/:id/deregister` | `{}` | `{ok}` |

### Provenance

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `POST` | `/provenance` | `{notePath, source, sourceUrl?, ...}` | `{record}` 201 |
| `GET` | `/provenance` | `?notePath=&source=&remoteNodeId=` | `{records}` |
| `DELETE` | `/provenance/:id` | — | `{ok}` |
| `GET` | `/provenance/nodes` | — | `{nodes: [{remoteNodeId, count, lastSync}]}` |
| `GET` | `/provenance/nodes/:nodeId` | — | `{records}` |

### OneDrive Connector

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/connectors/onedrive/list` | `{accessToken, driveId, folderId?, top?}` | `OneDriveListing` |

---

## MCP tools reference

Run `npm run serve:mcp` to start the MCP stdio server. Wire it into Claude Code
(or any MCP-capable agent) via `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "agent-memory-mesh": {
      "command": "npx",
      "args": ["tsx", "/path/to/agent-memory-mesh/src/cli/serve.ts", "--mcp"]
    }
  }
}
```

### Available tools

| Tool | Description |
|---|---|
| `search_memory` | Hybrid search (vector + keyword). Optional `policy`, `filter`, `k`. |
| `record_work_memory` | Log an agent action, output, or signal. |
| `record_correction` | Log a correction for the self-improvement loop. |
| `query_work_memory` | Query past actions by session, type, agent, or time. |
| `consolidate_sessions` | Synthesise sessions into vault lesson notes. |
| `submit_feedback` | Upvote or downvote a note to improve retrieval quality. |
| `process_corrections` | Convert unprocessed corrections to downvote signals. |
| `list_policies` | List all available retrieval policies. |
| `preload_wiki` | Return entity wiki summaries by name or explicit IDs. |
| `upsert_entity` | Add or update an entity in the context graph. |
| `add_graph_edge` | Connect two graph entities with a typed relation. |
| `query_graph_entities` | Find entities by type or name substring. |
| `get_entity_wiki` | Return (or build) the wiki summary for an entity. |
| `get_chunk_score` | Get the current access score for a vault note. |
| `record_provenance` | Record ingestion provenance for a note. |
| `get_provenance` | Get provenance records for a note. |
| `list_remote_provenance` | List provenance records by remote node ID. |
| `create_snapshot` | Snapshot current work memory, graph, and feedback state. |
| `list_snapshots` | List saved snapshots, newest first. |
| `restore_snapshot` | Restore state to a previous snapshot (auto-creates safety backup). |
| `inspect_stats` | Return aggregate memory statistics in a readable format. |
| `add_hook_rule` | Register an alert rule for a memory event. |
| `list_hook_rules` | List all registered hook rules. |
| `register_node` | Register or re-register a mesh node. |
| `list_nodes` | List mesh nodes, optionally filtered by status or capability. |
| `list_onedrive_files` | List files in a OneDrive folder via Microsoft Graph API. |

---

## CLI commands

| Command | Description |
|---|---|
| `npm run index` | Build or rebuild the retrieval index from the vault. |
| `npm run serve` | Start the HTTP API server (and optionally MCP if `--mcp` is passed). |
| `npm run serve:mcp` | Start the MCP stdio server. |
| `npm run consolidate [sessionId]` | Synthesise one or all work memory sessions into vault lesson notes. |
| `npm run graph` | Context graph CLI operations. |
| `npm run inspect` | Print current memory statistics (work memory count, graph size, etc.). |
| `npm run typecheck` | TypeScript type-check without emitting. |
| `npm test` | Run all test suites. |

---

## Tailscale mesh setup

See `docs/TAILSCALE.md` for the full guide. The short version:

1. Install Tailscale on every machine and add them to the same tailnet.
2. Paste `tailscale/acl.hujson` into your Tailscale admin ACL. It locks the
   memory port (8377) to tailnet members only.
3. On the machine running this service, set `MEMORY_HOST` to the machine's
   Tailscale hostname or IP.
4. On other machines, point `MEMORY_BASE_URL` at the HQ machine's tailnet address.

Each remote machine's mesh runner posts to `/invoke` and receives results back.
The node registry (`/nodes/register`, `/nodes/:id/heartbeat`) keeps track of
which runners are online and what they can do.

---

## Extending the brain

### Adding a new memory subsystem

1. Create `src/memory/your-store.ts` — a class that loads/saves JSON state.
2. Add its config path to `MemoryConfig` in `src/config.ts` with an `env()` default.
3. Instantiate it in `MemoryEngine` (`src/service/engine.ts`) and expose public methods.
4. Wire routes into `src/service/http.ts` and tools into `src/service/mcp.ts`.
5. Write a test suite in `test/your-store.test.ts` and register it in `test/run-tests.ts`.

### Adding a new connector

Drop a class in `src/connectors/your-connector.ts`. Connectors should:
- Accept an injectable fetch/HTTP client for unit testing.
- Return raw data only — never auto-index or auto-write.
- Declare clearly which permissions/tokens they need.

### Adding a new hook action

Extend the `dispatch()` method in `src/memory/hooks.ts` with a new `HookAction`
union member and its implementation. The condition evaluation in
`matchesCondition()` is separate from dispatch, so conditions work across all
actions automatically.

### Adding a retrieval policy

```bash
curl -X POST http://localhost:8377/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-policy",
    "k": 12,
    "boostRecent": true,
    "boostRecentFactor": 0.3,
    "includeWiki": true,
    "description": "High-recall with recency and wiki context"
  }'
```

---

## License

MIT — add a `LICENSE` file with your name as copyright holder.

# agent-memory-mesh

A shared, local-first **memory brain for AI agents** — one knowledge layer that
every agent, on every machine, can read. Obsidian is the durable store; LanceDB
provides hybrid (semantic + keyword) retrieval; embeddings run locally via Ollama;
and the brain is served over **HTTP and MCP** across a **Tailscale** mesh.

It fills the biggest gap in [Paperclip](https://github.com/paperclipai/paperclip)
(memory/knowledge is on its roadmap, not yet built) and works with any agent —
inside Paperclip or not.

## Why

Agents forget. Pasting whole vaults into prompts doesn't scale and doesn't work
across models. The fix is to keep memory **outside** the models and let each agent
retrieve only the relevant slice at query time — so the same brain serves Claude,
a local model, Hermes, anything. See `docs/MEMORY.md`.

## What's here

- `src/memory/` — vault loader, local embeddings, LanceDB hybrid store, indexer
- `src/service/` — the engine plus an **HTTP API** and an **MCP server**
- `src/cli/` — `index` (build the brain) and `serve` (run it)
- `docs/TAILSCALE.md` — the mesh fabric + a locked-down ACL
- `docs/INTEGRATION.md` — how Paperclip/agents use it (MCP + HTTP)
- `tailscale/acl.hujson` — ready-to-paste access policy

## Quickstart

```bash
cp .env.example .env          # set VAULT_PATH (and MEMORY_HOST/KEY to share)
npm install
ollama pull nomic-embed-text  # local, private embeddings
npm run index                 # build the brain from your vault
npm run serve                 # HTTP API on :8377
# or: npm run serve:mcp       # MCP stdio server for a co-located agent
```

Then follow `docs/TAILSCALE.md` to share it across your machines, and
`docs/INTEGRATION.md` to wire agents in.

## Make it yours (clean GitHub authoring history)

This ships without git history so your first commit is authored by **you**:

```bash
cd agent-memory-mesh
git init
git config user.name  "Your Name"
git config user.email "you@example.com"
git add -A
git commit -m "Initial commit: agent memory mesh"
# create an empty repo on GitHub under your account, then:
git remote add origin git@github.com:<you>/agent-memory-mesh.git
git push -u origin main
```

## License

MIT (recommended) — add a `LICENSE` file with your name as copyright holder.

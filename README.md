# Agent Memory

Agent Memory is the shared memory brain for Agent OS and remote nodes. It stores, retrieves, and serves knowledge across machines using a local-first architecture.

This repo turns Obsidian vault content and remote source summaries into a searchable memory layer with hybrid retrieval.

## What this repo does

- Loads content from an Obsidian vault.
- Builds local embeddings with Ollama or a compatible embedder.
- Stores memory in LanceDB for hybrid vector + keyword search.
- Exposes memory via HTTP and MCP APIs.
- Supports remote memory ingestion from other machines.
- Preserves provenance, source metadata, and health reporting.

## Capabilities

- Durable memory storage backed by Obsidian notes.
- Hybrid retrieval combining semantic vectors and keyword search.
- Remote node registration and health reporting.
- Memory search API for agents and dashboards.
- Provenance metadata attached to all memory entries.

## Installation

```bash
cd "Agent Memory"
cp .env.example .env
npm install
```

Update `.env` with your vault path and any optional values such as `MEMORY_API_KEY` or `MEMORY_HOST`.

```bash
npm run index
npm run serve
```

For MCP integration:

```bash
npm run serve:mcp
```

## Documentation

- `docs/TAILSCALE.md` - secure mesh setup for remote nodes.
- `docs/INTEGRATION.md` - how agents connect to memory via HTTP and MCP.

## Usage

Use this memory service as the shared brain for Agent OS and remote nodes. Configure the `MEMORY_API_KEY` in consuming agents and connect via the provided API.

# Integrating with Paperclip (and any agent)

The memory brain is deliberately **not** built as a Paperclip-internal plugin.
Paperclip's own developer notes show the external plugin/adapter loader is still
being wired, while **MCP** and plain **HTTP** are stable, proven seams (Paperclip's
Hermes adapter explicitly supports MCP). Building on those means the brain works
today, works with non-Paperclip agents too, and doesn't break when Paperclip's
internals change.

There are two ways an agent reaches the brain.

## A. MCP (for agents co-located with the brain)

An MCP-capable agent on the **same machine** as the memory service (e.g. a Hermes
agent on HQ) can use the brain as a native tool.

1. Run the MCP server: `npm run serve:mcp`
2. In the agent's MCP config, add this server (stdio command: `npm run serve:mcp`
   in this repo's directory).
3. The agent gains a `search_memory(query, k?, filter?)` tool.

For a Hermes agent in Paperclip, enable the `mcp` toolset in its `adapterConfig`
and register the memory MCP server in the agent's MCP settings.

## B. HTTP (for agents on other machines / any language)

Agents on the worker or work node reach the brain over the tailnet:

```
POST http://mac-2026.<your-tailnet>.ts.net:8377/search
Headers: X-Api-Key: <MEMORY_API_KEY>, Content-Type: application/json
Body:    { "query": "our standard proposal structure", "k": 6 }

-> { "hits": [ { "score": 0.03, "chunk": { "notePath": "...", "text": "..." } } ] }
```

The cleanest way to wire this into a Paperclip agent is a **skill** whose
instructions tell the agent to call the memory endpoint before drafting, plus the
endpoint + key provided via the agent's environment/secrets. (A remote agent that
prefers MCP can run a small stdio->HTTP shim; included as a follow-up.)

## Why this respects the work/personal boundary

The brain on HQ indexes personal/Obsidian content. Work content (Outlook, OneDrive,
proposals) is indexed **on the Windows work node** by its own instance of this
service, exposed only to the owner via the Tailscale ACL. Agents needing work
context query the work node directly; results — not raw files — flow back through
Paperclip. Nothing copies client data onto the personal machine.

## Roadmap fit

As Paperclip's plugin loader stabilizes, a thin first-class plugin can wrap this
same service (registering `search_memory` as a host tool and adding a UI panel)
without changing the engine. The HTTP + MCP service remains the source of truth.

/**
 * MCP server (stdio)
 * ------------------
 * Exposes the memory engine as MCP tools, so any MCP-capable agent running on
 * the same machine can query and write to the shared brain natively.
 * Remote agents on other machines use the HTTP API instead.
 *
 * Tools:
 *   search_memory(query, k?, filter?)     -> relevant passages with source + score
 *   record_work_memory(sessionId, type, summary, ...) -> recorded entry
 *   record_correction(sessionId, note, sourceEntryId?) -> correction entry
 *   query_work_memory(sessionId?, type?, since?, limit?) -> entries
 *   consolidate_sessions(sessionId?)      -> lesson notes written to vault
 *   upsert_entity(name, type, ...)        -> entity in context graph
 *   add_graph_edge(fromId, toId, relation) -> edge in context graph
 *   query_graph_entities(type?, name?)    -> entity list
 *   get_entity_wiki(entityId)             -> build/return entity wiki
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { MemoryConfig } from "../config.js";
import { MemoryEngine } from "./engine.js";

export async function startMcpStdio(cfg: MemoryConfig, engine: MemoryEngine): Promise<void> {
  const server = new McpServer({ name: "agent-memory-mesh", version: "0.1.0" });

  server.registerTool(
    "search_memory",
    {
      title: "Search memory",
      description:
        "Search the user's shared memory (Obsidian vault + indexed sources) for " +
        "passages relevant to a query. Returns source note, text, and a relevance score.",
      inputSchema: {
        query: z.string().describe("What to look for."),
        k: z.number().int().positive().optional().describe("How many passages (default 8)."),
        filter: z.string().optional().describe("Optional metadata filter, e.g. type = 'proposal'."),
        policy: z.string().optional().describe("Named retrieval policy (default, proposal-drafting, research, email-context, or custom)."),
      },
    },
    async ({ query, k, filter, policy }) => {
      if (policy) {
        const result = await engine.searchWithPolicy(query, policy, {
          k: k ?? undefined,
          filter: filter ?? undefined,
        });
        const wikiBlock = result.wikis.length
          ? "\n\n**Entity context:**\n" + result.wikis.map((w) => `- **${w.name}** (${w.type}): ${w.wiki}`).join("\n")
          : "";
        const hitsBlock = result.hits.length
          ? result.hits.map((h) => `- (${h.chunk.notePath}) ${h.chunk.text}`).join("\n")
          : "No relevant memory found.";
        return { content: [{ type: "text", text: hitsBlock + wikiBlock }] };
      }
      const hits = await engine.search(query, k ?? 8, filter);
      const text = hits.length
        ? hits.map((h) => `- (${h.chunk.notePath}) ${h.chunk.text}`).join("\n")
        : "No relevant memory found.";
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "record_work_memory",
    {
      title: "Record work memory",
      description:
        "Record an agent action, output, correction, or signal in the episodic work memory log. " +
        "Use this after every meaningful agent action so the brain can learn from experience.",
      inputSchema: {
        sessionId: z.string().describe("Unique session or task identifier."),
        type: z
          .enum(["action", "output", "correction", "signal", "search"])
          .describe("Entry type."),
        summary: z.string().describe("Human-readable summary of what happened."),
        command: z.string().optional().describe("Command or tool that was invoked."),
        args: z.record(z.unknown()).optional().describe("Arguments passed."),
        result: z.unknown().optional().describe("Result or output produced."),
        success: z.boolean().optional().describe("Whether the action succeeded."),
        taskId: z.string().optional().describe("Parent task or ticket identifier."),
        agentId: z.string().optional().describe("Agent identifier."),
        tags: z.array(z.string()).optional().describe("Free-form tags."),
      },
    },
    async (input) => {
      const entry = engine.recordWork(input as any);
      return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
    }
  );

  server.registerTool(
    "record_correction",
    {
      title: "Record correction",
      description:
        "Record a human or agent correction — a note about what went wrong and what should change. " +
        "These feed the self-improvement loop during consolidation.",
      inputSchema: {
        sessionId: z.string().describe("Session this correction belongs to."),
        note: z.string().describe("What was wrong and what the correct approach is."),
        sourceEntryId: z
          .string()
          .optional()
          .describe("ID of the work memory entry this corrects."),
      },
    },
    async ({ sessionId, note, sourceEntryId }) => {
      const entry = engine.recordCorrection(sessionId, note, sourceEntryId);
      return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
    }
  );

  server.registerTool(
    "query_work_memory",
    {
      title: "Query work memory",
      description:
        "Query the episodic work memory log for past actions, outputs, corrections, and signals. " +
        "Useful for understanding what an agent did in a session and whether it succeeded.",
      inputSchema: {
        sessionId: z.string().optional().describe("Filter by session ID."),
        type: z
          .enum(["action", "output", "correction", "signal", "search"])
          .optional()
          .describe("Filter by entry type."),
        agentId: z.string().optional().describe("Filter by agent ID."),
        since: z.string().optional().describe("ISO timestamp — only entries after this time."),
        limit: z.number().int().positive().optional().describe("Max entries to return."),
      },
    },
    async ({ sessionId, type, agentId, since, limit }) => {
      const entries = engine.queryWork({ sessionId, type, agentId, since, limit });
      const text = entries.length
        ? entries.map((e) => `[${e.timestamp}] ${e.type}: ${e.summary}`).join("\n")
        : "No work memory entries found.";
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "consolidate_sessions",
    {
      title: "Consolidate sessions",
      description:
        "Synthesise one or all work memory sessions into concise lesson notes written to the vault. " +
        "Run this at the end of a session or on a schedule to compress episodic records into lasting knowledge.",
      inputSchema: {
        sessionId: z
          .string()
          .optional()
          .describe("Specific session to consolidate. Omit to consolidate all sessions."),
      },
    },
    async ({ sessionId }) => {
      if (sessionId) {
        const result = await engine.consolidateSession(sessionId);
        return {
          content: [
            {
              type: "text",
              text:
                `Consolidated session "${result.sessionId}" → ${result.lessonPath}\n` +
                `${result.entryCount} entries, ${result.successCount} successes, ` +
                `${result.failureCount} failures, ${result.correctionCount} corrections (${result.method})`,
            },
          ],
        };
      }
      const results = await engine.consolidateAll();
      const text = results.length
        ? results
            .map(
              (r) =>
                `✓ "${r.sessionId}" → ${r.lessonPath} (${r.entryCount} entries, ${r.method})`
            )
            .join("\n")
        : "No sessions found to consolidate.";
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "list_policies",
    {
      title: "List retrieval policies",
      description: "Return all available retrieval policies (built-in and custom).",
      inputSchema: {},
    },
    async () => {
      const policies = engine.listPolicies();
      const text = policies
        .map((p) => `**${p.name}**: k=${p.k}${p.filter ? `, filter: ${p.filter}` : ""}${p.boostRecent ? ", boostRecent" : ""}${p.includeWiki ? ", includeWiki" : ""} — ${p.description ?? ""}`)
        .join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "preload_wiki",
    {
      title: "Preload entity wikis",
      description:
        "Return wiki summaries for entities in the context graph that match a query or explicit IDs. " +
        "Use this to inject structured entity knowledge into an agent's context at task start.",
      inputSchema: {
        query: z.string().optional().describe("Find entities whose name matches this query."),
        entityIds: z.array(z.string()).optional().describe("Explicit entity IDs to fetch."),
        limit: z.number().int().positive().optional().describe("Max wikis to return (default 10)."),
      },
    },
    async ({ query, entityIds, limit }) => {
      const wikis = engine.preloadWiki({ query, entityIds, limit });
      const text = wikis.length
        ? wikis.map((w) => `**${w.name}** (${w.type}):\n${w.wiki}`).join("\n\n")
        : "No entity wikis found.";
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "upsert_entity",
    {
      title: "Upsert graph entity",
      description:
        "Add or update an entity in the context graph. Entities are projects, people, documents, " +
        "connectors, or concepts. Idempotent — calling twice with the same name updates in place.",
      inputSchema: {
        name: z.string().describe("Human-readable entity name."),
        type: z.enum(["project", "person", "document", "connector", "concept"]).describe("Entity type."),
        description: z.string().optional().describe("Short description of the entity."),
        tags: z.array(z.string()).optional().describe("Free-form tags."),
        id: z.string().optional().describe("Explicit ID — omit to auto-generate or match by name."),
      },
    },
    async (input) => {
      const entity = engine.upsertEntity(input as any);
      return { content: [{ type: "text", text: JSON.stringify(entity, null, 2) }] };
    }
  );

  server.registerTool(
    "add_graph_edge",
    {
      title: "Add context graph edge",
      description: "Connect two entities with a typed relation. Both entities must already exist.",
      inputSchema: {
        fromId: z.string().describe("Source entity ID."),
        toId: z.string().describe("Target entity ID."),
        relation: z.string().describe("Relation type, e.g. 'works_on', 'owns', 'belongs_to', 'references'."),
        weight: z.number().optional().describe("Optional relevance weight (0-1)."),
      },
    },
    async ({ fromId, toId, relation, weight }) => {
      const edge = engine.addEdge(fromId, toId, relation, weight);
      return { content: [{ type: "text", text: JSON.stringify(edge, null, 2) }] };
    }
  );

  server.registerTool(
    "query_graph_entities",
    {
      title: "Query context graph",
      description: "Find entities in the context graph by type or name substring.",
      inputSchema: {
        type: z.enum(["project", "person", "document", "connector", "concept"]).optional().describe("Filter by entity type."),
        name: z.string().optional().describe("Filter by name substring."),
      },
    },
    async ({ type, name }) => {
      let entities = engine.listEntities();
      if (type) entities = entities.filter((e) => e.type === type);
      if (name) entities = entities.filter((e) => e.name.toLowerCase().includes(name.toLowerCase()));
      const text = entities.length
        ? entities.map((e) => `[${e.type}] ${e.name} (${e.id})${e.wiki ? "\n  " + e.wiki : ""}`).join("\n")
        : "No entities found.";
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "get_entity_wiki",
    {
      title: "Get or build entity wiki",
      description:
        "Return the wiki summary for an entity, building it if not yet generated. " +
        "The wiki is a compact description suitable for injection into agent context.",
      inputSchema: {
        entityId: z.string().describe("Entity ID."),
      },
    },
    async ({ entityId }) => {
      const entity = await engine.buildEntityWiki(entityId);
      return {
        content: [
          {
            type: "text",
            text: `**${entity.name}** (${entity.type})\n\n${entity.wiki ?? "No wiki generated."}`,
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] agent-memory-mesh stdio server ready");
}

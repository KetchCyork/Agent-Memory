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
      },
    },
    async ({ query, k, filter }) => {
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] agent-memory-mesh stdio server ready");
}

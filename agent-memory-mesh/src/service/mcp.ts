/**
 * MCP server (stdio)
 * ------------------
 * Exposes the memory engine as an MCP tool, so any MCP-capable agent running on
 * the same machine (e.g. a Hermes agent — its adapter supports MCP) can query the
 * shared brain natively. Remote agents on other machines use the HTTP API instead
 * (stdio is local-only); a remote agent can also run a thin stdio->HTTP shim.
 *
 * Tool exposed:
 *   search_memory(query, k?, filter?) -> relevant passages with source + score
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] agent-memory-mesh stdio server ready");
}

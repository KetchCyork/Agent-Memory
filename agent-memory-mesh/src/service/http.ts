/**
 * HTTP service
 * ------------
 * A tiny REST API over the memory engine, using only Node's built-in http
 * (no framework dependency). This is the universal seam: any agent on any
 * machine, in any language, can reach the shared brain over the tailnet.
 *
 * Endpoints:
 *   GET  /health                      -> { ok: true }
 *   POST /search   { query, k?, filter? }   -> { hits: [...] }
 *   POST /reindex  {}                  -> { notes, chunks }
 *
 * Auth: if MEMORY_API_KEY is set, every request must send X-Api-Key with it.
 * Bind: set MEMORY_HOST to your tailnet name/IP to share; defaults to loopback.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { MemoryConfig } from "../config.js";
import { MemoryEngine } from "./engine.js";

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Invalid JSON body"); }
}

export function startHttp(cfg: MemoryConfig, engine: MemoryEngine): void {
  const server = createServer(async (req, res) => {
    try {
      // Simple shared-secret auth, if configured.
      if (cfg.apiKey && req.headers["x-api-key"] !== cfg.apiKey) {
        return send(res, 401, { error: "unauthorized" });
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, service: "agent-memory-mesh" });
      }

      if (req.method === "POST" && url.pathname === "/search") {
        const body = await readJson(req);
        const query = String(body.query ?? "").trim();
        if (!query) return send(res, 400, { error: "query is required" });
        const k = Number.isFinite(body.k) ? Number(body.k) : 8;
        const hits = await engine.search(query, k, body.filter ? String(body.filter) : undefined);
        return send(res, 200, { hits });
      }

      if (req.method === "POST" && url.pathname === "/reindex") {
        const result = await engine.reindex();
        return send(res, 200, result);
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, 500, { error: String(err) });
    }
  });

  server.listen(cfg.port, cfg.host, () => {
    const where = cfg.host === "127.0.0.1" ? "loopback only" : "shared on the tailnet";
    console.log(`[http] memory API on http://${cfg.host}:${cfg.port} (${where})`);
    if (!cfg.apiKey && cfg.host !== "127.0.0.1") {
      console.warn("[http] WARNING: bound beyond loopback with no MEMORY_API_KEY set.");
    }
  });
}

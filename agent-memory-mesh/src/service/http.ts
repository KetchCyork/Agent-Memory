/**
 * HTTP service
 * ------------
 * A tiny REST API over the memory engine, using only Node's built-in http
 * (no framework dependency). This is the universal seam: any agent on any
 * machine, in any language, can reach the shared brain over the tailnet.
 *
 * Endpoints:
 *   GET  /health                           -> { ok: true }
 *   POST /search   { query, k?, filter?, policy? }  -> { hits, wikis?, policy? }
 *   POST /reindex  {}                      -> { notes, chunks }
 *   POST /work-memory  { entry }           -> { entry }
 *   GET  /work-memory  [?sessionId&type&agentId&since&limit]  -> { entries }
 *   POST /work-memory/correction           -> { entry }
 *   GET  /work-memory/session/:id          -> { entries }
 *   GET  /policies                         -> { policies }
 *   POST /policies                         -> { policy }
 *   DELETE /policies/:name                 -> { ok }
 *   POST /wiki/preload  { query?, entityIds?, limit? }  -> { wikis }
 *   POST /feedback/upvote   { notePath, sessionId?, query?, note? }   -> { signal }
 *   POST /feedback/downvote { notePath, sessionId?, query?, note? }   -> { signal }
 *   POST /feedback/process  {}             -> { processed, signals }
 *   GET  /feedback/signals[?notePath=]     -> { signals }
 *   GET  /feedback/summary                 -> { topUpvoted, topDownvoted, totalSignals }
 *   POST /consolidate                      -> { results: ConsolidationResult[] }
 *   POST /consolidate/:sessionId           -> { result: ConsolidationResult }
 *   POST /graph/entities                   -> { entity }
 *   GET  /graph/entities[?type=&name=]     -> { entities }
 *   GET  /graph/entities/:id               -> { entity, edges, neighbors }
 *   DELETE /graph/entities/:id             -> { ok }
 *   POST /graph/edges                      -> { edge }
 *   DELETE /graph/edges/:id                -> { ok }
 *   GET  /graph/entities/:id/neighbors     -> { neighbors }
 *   POST /graph/wiki/:id                   -> { entity }
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

export function startHttp(
  cfg: MemoryConfig,
  engine: MemoryEngine
): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve) => {
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
        if (body.policy) {
          const result = await engine.searchWithPolicy(query, String(body.policy), {
            k: Number.isFinite(body.k) ? Number(body.k) : undefined,
            filter: body.filter ? String(body.filter) : undefined,
          });
          return send(res, 200, result);
        }
        const k = Number.isFinite(body.k) ? Number(body.k) : 8;
        const hits = await engine.search(query, k, body.filter ? String(body.filter) : undefined);
        return send(res, 200, { hits });
      }

      if (req.method === "POST" && url.pathname === "/reindex") {
        const result = await engine.reindex();
        return send(res, 200, result);
      }

      // Retrieval policy endpoints

      if (req.method === "GET" && url.pathname === "/policies") {
        return send(res, 200, { policies: engine.listPolicies() });
      }

      if (req.method === "POST" && url.pathname === "/policies") {
        const body = await readJson(req);
        if (!body.name) return send(res, 400, { error: "name is required" });
        if (typeof body.k !== "number") return send(res, 400, { error: "k (number) is required" });
        try {
          const policy = engine.upsertPolicy(body);
          return send(res, 201, { policy });
        } catch (err: any) {
          return send(res, 400, { error: err.message });
        }
      }

      const policyNameMatch = url.pathname.match(/^\/policies\/(.+)$/);
      if (req.method === "DELETE" && policyNameMatch) {
        try {
          const ok = engine.deletePolicy(decodeURIComponent(policyNameMatch[1]));
          return send(res, ok ? 200 : 404, { ok });
        } catch (err: any) {
          return send(res, 400, { error: err.message });
        }
      }

      if (req.method === "POST" && url.pathname === "/wiki/preload") {
        const body = await readJson(req);
        const wikis = engine.preloadWiki({
          query: body.query ? String(body.query) : undefined,
          entityIds: Array.isArray(body.entityIds) ? body.entityIds : undefined,
          limit: Number.isFinite(body.limit) ? Number(body.limit) : undefined,
        });
        return send(res, 200, { wikis });
      }

      // Work memory endpoints

      if (req.method === "POST" && url.pathname === "/work-memory") {
        const body = await readJson(req);
        if (!body.sessionId) return send(res, 400, { error: "sessionId is required" });
        if (!body.type) return send(res, 400, { error: "type is required" });
        if (!body.summary) return send(res, 400, { error: "summary is required" });
        const entry = engine.recordWork(body);
        return send(res, 201, { entry });
      }

      if (req.method === "GET" && url.pathname === "/work-memory") {
        const q = url.searchParams;
        const entries = engine.queryWork({
          sessionId: q.get("sessionId") ?? undefined,
          type: (q.get("type") as any) ?? undefined,
          agentId: q.get("agentId") ?? undefined,
          since: q.get("since") ?? undefined,
          limit: q.has("limit") ? Number(q.get("limit")) : undefined,
        });
        return send(res, 200, { entries });
      }

      if (req.method === "POST" && url.pathname === "/work-memory/correction") {
        const body = await readJson(req);
        if (!body.sessionId) return send(res, 400, { error: "sessionId is required" });
        if (!body.note) return send(res, 400, { error: "note is required" });
        const entry = engine.recordCorrection(body.sessionId, body.note, body.sourceEntryId);
        return send(res, 201, { entry });
      }

      const sessionMatch = url.pathname.match(/^\/work-memory\/session\/(.+)$/);
      if (req.method === "GET" && sessionMatch) {
        const entries = engine.getWorkSession(sessionMatch[1]);
        return send(res, 200, { entries });
      }

      // Feedback loop endpoints

      if (req.method === "POST" && (url.pathname === "/feedback/upvote" || url.pathname === "/feedback/downvote")) {
        const body = await readJson(req);
        if (!body.notePath) return send(res, 400, { error: "notePath is required" });
        const vote = url.pathname.endsWith("upvote") ? "up" : "down";
        const signal = engine.submitFeedback(body.notePath, vote, {
          sessionId: body.sessionId,
          query: body.query,
          note: body.note,
          workMemoryEntryId: body.workMemoryEntryId,
        });
        return send(res, 201, { signal });
      }

      if (req.method === "POST" && url.pathname === "/feedback/process") {
        const result = engine.processCorrections();
        return send(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/feedback/signals") {
        const notePath = url.searchParams.get("notePath") ?? undefined;
        const signals = engine.listFeedbackSignals(notePath);
        return send(res, 200, { signals });
      }

      if (req.method === "GET" && url.pathname === "/feedback/summary") {
        return send(res, 200, engine.getFeedbackSummary());
      }

      // Consolidation endpoints

      if (req.method === "POST" && url.pathname === "/consolidate") {
        const results = await engine.consolidateAll();
        return send(res, 200, { results });
      }

      const consolidateMatch = url.pathname.match(/^\/consolidate\/(.+)$/);
      if (req.method === "POST" && consolidateMatch) {
        const sessionId = decodeURIComponent(consolidateMatch[1]);
        const result = await engine.consolidateSession(sessionId);
        return send(res, 200, { result });
      }

      // Context graph endpoints

      if (req.method === "POST" && url.pathname === "/graph/entities") {
        const body = await readJson(req);
        if (!body.name) return send(res, 400, { error: "name is required" });
        if (!body.type) return send(res, 400, { error: "type is required" });
        const entity = engine.upsertEntity(body);
        return send(res, 201, { entity });
      }

      if (req.method === "GET" && url.pathname === "/graph/entities") {
        const q = url.searchParams;
        let entities = engine.listEntities();
        if (q.has("type")) entities = entities.filter((e) => e.type === q.get("type"));
        if (q.has("name")) entities = engine.findEntitiesByName(q.get("name")!);
        return send(res, 200, { entities });
      }

      const entityIdMatch = url.pathname.match(/^\/graph\/entities\/([^/]+)$/);
      if (entityIdMatch) {
        const id = decodeURIComponent(entityIdMatch[1]);
        if (req.method === "GET") {
          const entity = engine.getEntity(id);
          if (!entity) return send(res, 404, { error: "entity not found" });
          const edges = engine.getEdges(id);
          const neighbors = engine.getNeighbors(id);
          return send(res, 200, { entity, edges, neighbors });
        }
        if (req.method === "DELETE") {
          const ok = engine.removeEntity(id);
          return send(res, ok ? 200 : 404, { ok });
        }
      }

      if (req.method === "POST" && url.pathname === "/graph/edges") {
        const body = await readJson(req);
        if (!body.fromId) return send(res, 400, { error: "fromId is required" });
        if (!body.toId) return send(res, 400, { error: "toId is required" });
        if (!body.relation) return send(res, 400, { error: "relation is required" });
        if (!engine.getEntity(body.fromId)) return send(res, 400, { error: "fromId entity not found" });
        if (!engine.getEntity(body.toId)) return send(res, 400, { error: "toId entity not found" });
        const edge = engine.addEdge(body.fromId, body.toId, body.relation, body.weight, body.metadata);
        return send(res, 201, { edge });
      }

      const edgeIdMatch = url.pathname.match(/^\/graph\/edges\/([^/]+)$/);
      if (req.method === "DELETE" && edgeIdMatch) {
        const ok = engine.removeEdge(decodeURIComponent(edgeIdMatch[1]));
        return send(res, ok ? 200 : 404, { ok });
      }

      const neighborsMatch = url.pathname.match(/^\/graph\/entities\/([^/]+)\/neighbors$/);
      if (req.method === "GET" && neighborsMatch) {
        const id = decodeURIComponent(neighborsMatch[1]);
        if (!engine.getEntity(id)) return send(res, 404, { error: "entity not found" });
        const neighbors = engine.getNeighbors(id);
        return send(res, 200, { neighbors });
      }

      const wikiMatch = url.pathname.match(/^\/graph\/wiki\/([^/]+)$/);
      if (req.method === "POST" && wikiMatch) {
        const id = decodeURIComponent(wikiMatch[1]);
        const entity = await engine.buildEntityWiki(id);
        return send(res, 200, { entity });
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, 500, { error: String(err) });
    }
  });

  server.listen(cfg.port, cfg.host, () => {
    const addr = server.address() as { port: number };
    const where = cfg.host === "127.0.0.1" ? "loopback only" : "shared on the tailnet";
    console.log(`[http] memory API on http://${cfg.host}:${addr.port} (${where})`);
    if (!cfg.apiKey && cfg.host !== "127.0.0.1") {
      console.warn("[http] WARNING: bound beyond loopback with no MEMORY_API_KEY set.");
    }
    resolve(server);
  });
  });
}

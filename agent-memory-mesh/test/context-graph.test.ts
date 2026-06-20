/**
 * Tests for ContextGraph (unit) and /graph HTTP endpoints (integration).
 * No Ollama, no LanceDB — graph is pure JSON-file backed.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import type { Server } from "node:http";
import { ContextGraph } from "../src/memory/context-graph.js";
import { WorkMemoryStore } from "../src/memory/work-memory.js";
import { Consolidator } from "../src/memory/consolidator.js";
import { startHttp } from "../src/service/http.js";
import type { MemoryEngine } from "../src/service/engine.js";
import type { MemoryConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type TestFn = () => void | Promise<void>;
const tests: [string, TestFn][] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: TestFn): void {
  tests.push([name, fn]);
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected)
    throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

let tmpDir: string;
let httpServer: Server | undefined;
let httpPort: number;

function tmpFile(name: string): string {
  return join(tmpDir, name);
}

async function req(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const r = nodeRequest(
      {
        hostname: "127.0.0.1",
        port: httpPort,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": String(Buffer.byteLength(payload)) } : {}),
        },
      },
      (resp) => {
        const chunks: Buffer[] = [];
        resp.on("data", (c) => chunks.push(c as Buffer));
        resp.on("end", () => {
          try {
            resolve({ status: resp.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) });
          } catch {
            resolve({ status: resp.statusCode ?? 0, body: null });
          }
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ---------------------------------------------------------------------------
// Unit tests — ContextGraph
// ---------------------------------------------------------------------------

test("upsertEntity creates an entity with id and timestamps", () => {
  const g = new ContextGraph(tmpFile("graph-create.json"));
  const e = g.upsertEntity({ name: "Proposal project", type: "project" });
  assert(typeof e.id === "string" && e.id.length > 0, "id set");
  assert(typeof e.createdAt === "string", "createdAt set");
  assertEqual(e.name, "Proposal project", "name");
  assertEqual(e.type, "project", "type");
});

test("upsertEntity updates existing entity by name", () => {
  const g = new ContextGraph(tmpFile("graph-update.json"));
  const e1 = g.upsertEntity({ name: "Chris York", type: "person" });
  const e2 = g.upsertEntity({ name: "Chris York", type: "person", description: "Principal consultant" });
  assertEqual(e1.id, e2.id, "same id after update");
  assertEqual(e2.description, "Principal consultant", "description updated");
});

test("upsertEntity persists across instances", () => {
  const path = tmpFile("graph-persist.json");
  const g1 = new ContextGraph(path);
  const e = g1.upsertEntity({ name: "OneDrive connector", type: "connector" });
  const g2 = new ContextGraph(path);
  const loaded = g2.getEntity(e.id);
  assert(!!loaded, "entity found after reload");
  assertEqual(loaded!.name, "OneDrive connector", "name persisted");
});

test("findByType returns matching entities", () => {
  const g = new ContextGraph(tmpFile("graph-type.json"));
  g.upsertEntity({ name: "Alice", type: "person" });
  g.upsertEntity({ name: "Bob", type: "person" });
  g.upsertEntity({ name: "Vault docs", type: "document" });
  const people = g.findByType("person");
  assertEqual(people.length, 2, "two people");
  assert(people.every((e) => e.type === "person"), "all are persons");
});

test("findByName does case-insensitive substring match", () => {
  const g = new ContextGraph(tmpFile("graph-name.json"));
  g.upsertEntity({ name: "Proposal Pipeline", type: "project" });
  g.upsertEntity({ name: "Another Project", type: "project" });
  const results = g.findByName("proposal");
  assertEqual(results.length, 1, "one match");
  assertEqual(results[0].name, "Proposal Pipeline", "correct entity");
});

test("addEdge creates a directed edge between entities", () => {
  const g = new ContextGraph(tmpFile("graph-edge.json"));
  const alice = g.upsertEntity({ name: "Alice", type: "person" });
  const proj = g.upsertEntity({ name: "Alpha project", type: "project" });
  const edge = g.addEdge(alice.id, proj.id, "works_on");
  assert(typeof edge.id === "string", "edge id set");
  assertEqual(edge.fromId, alice.id, "fromId");
  assertEqual(edge.toId, proj.id, "toId");
  assertEqual(edge.relation, "works_on", "relation");
});

test("neighbors returns connected entities with direction", () => {
  const g = new ContextGraph(tmpFile("graph-neighbors.json"));
  const alice = g.upsertEntity({ name: "Alice", type: "person" });
  const proj = g.upsertEntity({ name: "Alpha project", type: "project" });
  g.addEdge(alice.id, proj.id, "works_on");
  const aliceNeighbors = g.neighbors(alice.id);
  assertEqual(aliceNeighbors.length, 1, "alice has one neighbor");
  assertEqual(aliceNeighbors[0].entity.id, proj.id, "neighbor is proj");
  assertEqual(aliceNeighbors[0].direction, "outbound", "outbound from alice");
  const projNeighbors = g.neighbors(proj.id);
  assertEqual(projNeighbors.length, 1, "proj has one neighbor");
  assertEqual(projNeighbors[0].direction, "inbound", "inbound to proj");
});

test("removeEntity cascades to connected edges", () => {
  const g = new ContextGraph(tmpFile("graph-remove.json"));
  const a = g.upsertEntity({ name: "A", type: "concept" });
  const b = g.upsertEntity({ name: "B", type: "concept" });
  g.addEdge(a.id, b.id, "related_to");
  assertEqual(g.getEdges().length, 1, "one edge before remove");
  g.removeEntity(a.id);
  assert(!g.getEntity(a.id), "entity a removed");
  assertEqual(g.getEdges().length, 0, "edge removed with entity");
});

test("removeEdge removes only the specified edge", () => {
  const g = new ContextGraph(tmpFile("graph-remove-edge.json"));
  const x = g.upsertEntity({ name: "X", type: "concept" });
  const y = g.upsertEntity({ name: "Y", type: "concept" });
  const e1 = g.addEdge(x.id, y.id, "references");
  const e2 = g.addEdge(y.id, x.id, "references");
  g.removeEdge(e1.id);
  const remaining = g.getEdges();
  assertEqual(remaining.length, 1, "one edge remains");
  assertEqual(remaining[0].id, e2.id, "correct edge remains");
});

test("buildWiki (rule-based) generates a wiki string", async () => {
  const g = new ContextGraph(tmpFile("graph-wiki.json"));
  const person = g.upsertEntity({ name: "Chris York", type: "person", description: "Principal consultant at TSP Tech", tags: ["leadership"] });
  const proj = g.upsertEntity({ name: "Proposal system", type: "project" });
  g.addEdge(person.id, proj.id, "owns");
  const updated = await g.buildWiki(person.id);
  assert(typeof updated.wiki === "string" && updated.wiki.length > 0, "wiki is a non-empty string");
  assert(updated.wiki!.includes("Chris York"), "wiki mentions name");
  assert(updated.wiki!.includes("Proposal system"), "wiki mentions connected entity");
});

test("updateWiki sets wiki and wikiUpdatedAt", () => {
  const g = new ContextGraph(tmpFile("graph-update-wiki.json"));
  const e = g.upsertEntity({ name: "Concept A", type: "concept" });
  const updated = g.updateWiki(e.id, "Concept A is a foundational idea.");
  assertEqual(updated.wiki, "Concept A is a foundational idea.", "wiki set");
  assert(typeof updated.wikiUpdatedAt === "string", "wikiUpdatedAt set");
});

// ---------------------------------------------------------------------------
// Integration tests — HTTP /graph endpoints
// ---------------------------------------------------------------------------

let graphInstance: ContextGraph;

test("POST /graph/entities creates entity (201)", async () => {
  const { status, body } = await req("POST", "/graph/entities", {
    name: "HQ MacBook",
    type: "connector",
    description: "Primary orchestration node",
  });
  assertEqual(status, 201, "status 201");
  assert(!!body.entity?.id, "entity has id");
  assertEqual(body.entity.name, "HQ MacBook", "name matches");
  assertEqual(body.entity.type, "connector", "type matches");
});

test("POST /graph/entities returns 400 without name", async () => {
  const { status } = await req("POST", "/graph/entities", { type: "project" });
  assertEqual(status, 400, "status 400");
});

test("GET /graph/entities returns all entities", async () => {
  const { status, body } = await req("GET", "/graph/entities");
  assertEqual(status, 200, "status 200");
  assert(Array.isArray(body.entities), "entities is array");
  assert(body.entities.length >= 1, "at least one entity");
});

test("GET /graph/entities?type= filters by type", async () => {
  await req("POST", "/graph/entities", { name: "TypeFilter Person", type: "person" });
  const { body } = await req("GET", "/graph/entities?type=person");
  assert(body.entities.every((e: any) => e.type === "person"), "all are persons");
});

test("GET /graph/entities/:id returns entity with edges and neighbors", async () => {
  const { body: b1 } = await req("POST", "/graph/entities", { name: "GraphGetA", type: "concept" });
  const { body: b2 } = await req("POST", "/graph/entities", { name: "GraphGetB", type: "concept" });
  await req("POST", "/graph/edges", { fromId: b1.entity.id, toId: b2.entity.id, relation: "related_to" });
  const { status, body } = await req("GET", `/graph/entities/${b1.entity.id}`);
  assertEqual(status, 200, "status 200");
  assert(!!body.entity, "entity present");
  assert(Array.isArray(body.edges), "edges array");
  assert(Array.isArray(body.neighbors), "neighbors array");
  assertEqual(body.neighbors.length, 1, "one neighbor");
});

test("DELETE /graph/entities/:id removes entity", async () => {
  const { body: b } = await req("POST", "/graph/entities", { name: "ToDelete", type: "concept" });
  const { status } = await req("DELETE", `/graph/entities/${b.entity.id}`);
  assertEqual(status, 200, "status 200");
  const { status: s2 } = await req("GET", `/graph/entities/${b.entity.id}`);
  assertEqual(s2, 404, "entity gone after delete");
});

test("POST /graph/edges creates edge between entities", async () => {
  const { body: bA } = await req("POST", "/graph/entities", { name: "EdgeNodeA", type: "concept" });
  const { body: bB } = await req("POST", "/graph/entities", { name: "EdgeNodeB", type: "concept" });
  const { status, body } = await req("POST", "/graph/edges", {
    fromId: bA.entity.id,
    toId: bB.entity.id,
    relation: "references",
  });
  assertEqual(status, 201, "status 201");
  assertEqual(body.edge.relation, "references", "relation matches");
});

test("POST /graph/edges returns 400 for unknown entity", async () => {
  const { status } = await req("POST", "/graph/edges", {
    fromId: "does-not-exist",
    toId: "also-not-exist",
    relation: "related_to",
  });
  assertEqual(status, 400, "status 400");
});

test("GET /graph/entities/:id/neighbors returns neighbor list", async () => {
  const { body: bX } = await req("POST", "/graph/entities", { name: "NbrX", type: "concept" });
  const { body: bY } = await req("POST", "/graph/entities", { name: "NbrY", type: "concept" });
  await req("POST", "/graph/edges", { fromId: bX.entity.id, toId: bY.entity.id, relation: "uses" });
  const { status, body } = await req("GET", `/graph/entities/${bX.entity.id}/neighbors`);
  assertEqual(status, 200, "status 200");
  assertEqual(body.neighbors.length, 1, "one neighbor");
  assertEqual(body.neighbors[0].entity.name, "NbrY", "correct neighbor");
});

test("POST /graph/wiki/:id builds wiki and returns entity", async () => {
  const { body: b } = await req("POST", "/graph/entities", { name: "WikiEntity", type: "project", description: "Test wiki project" });
  const { status, body } = await req("POST", `/graph/wiki/${b.entity.id}`);
  assertEqual(status, 200, "status 200");
  assert(typeof body.entity.wiki === "string" && body.entity.wiki.length > 0, "wiki generated");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runContextGraphTests(): Promise<void> {
  tmpDir = join(tmpdir(), `context-graph-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const graphPath = tmpFile("graph-http.json");
  graphInstance = new ContextGraph(graphPath);
  const workStore = new WorkMemoryStore(tmpFile("wm-graph.json"));
  const vaultPath = tmpFile("vault-graph");
  const consolidatorInst = new Consolidator(workStore, { vaultPath });

  const mockEngine = {
    // vault search
    search: async () => [],
    reindex: async () => ({ notes: 0, chunks: 0 }),
    // work memory
    recordWork: (e: any) => workStore.record(e),
    queryWork: (q: any) => workStore.query(q),
    getWorkSession: (id: string) => workStore.getSession(id),
    recordCorrection: (sid: string, note: string, ref?: string) => workStore.recordCorrection(sid, note, ref),
    // consolidation
    consolidateAll: () => consolidatorInst.consolidateAll(),
    consolidateSession: (id: string) => consolidatorInst.consolidateSession(id),
    // graph
    upsertEntity: (input: any) => graphInstance.upsertEntity(input),
    getEntity: (id: string) => graphInstance.getEntity(id),
    removeEntity: (id: string) => graphInstance.removeEntity(id),
    listEntities: () => graphInstance.listEntities(),
    findEntitiesByType: (type: any) => graphInstance.findByType(type),
    findEntitiesByName: (name: string) => graphInstance.findByName(name),
    addEdge: (f: string, t: string, r: string, w?: number, m?: any) => graphInstance.addEdge(f, t, r, w, m),
    removeEdge: (id: string) => graphInstance.removeEdge(id),
    getEdges: (id?: string) => graphInstance.getEdges(id),
    getNeighbors: (id: string) => graphInstance.neighbors(id),
    buildEntityWiki: (id: string) => graphInstance.buildWiki(id),
    buildAllWikis: () => graphInstance.buildAllWikis(),
  } as unknown as MemoryEngine;

  const cfg: MemoryConfig = {
    vaultPath,
    dbPath: join(tmpDir, "lancedb"),
    workMemoryPath: tmpFile("wm-graph.json"),
    graphPath,
    ollamaUrl: "http://localhost:11434",
    embedModel: "nomic-embed-text",
    host: "127.0.0.1",
    port: 0,
    apiKey: "",
    consolidationModel: "",
  };

  httpServer = await startHttp(cfg, mockEngine);
  httpPort = (httpServer.address() as { port: number }).port;

  console.log("\n--- Context Graph Tests ---");

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
  }

  httpServer.close();

  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) throw new Error(`${failed} context graph test(s) failed`);
}

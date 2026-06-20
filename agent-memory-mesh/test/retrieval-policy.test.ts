/**
 * Tests for RetrievalPolicyStore, applyRecencyBoost, and retrieval policy HTTP endpoints.
 * No Ollama or LanceDB required.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import type { Server } from "node:http";
import { RetrievalPolicyStore, applyRecencyBoost, type RetrievalPolicy } from "../src/memory/retrieval-policy.js";
import { ContextGraph } from "../src/memory/context-graph.js";
import { WorkMemoryStore } from "../src/memory/work-memory.js";
import { Consolidator } from "../src/memory/consolidator.js";
import { startHttp } from "../src/service/http.js";
import type { MemoryEngine, WikiSummary, PolicySearchResult } from "../src/service/engine.js";
import type { MemoryConfig } from "../src/config.js";
import type { RetrievalHit } from "../src/memory/store.js";

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
// Fake RetrievalHit helper
// ---------------------------------------------------------------------------

function fakeHit(text: string, score: number, updated: string): RetrievalHit {
  return {
    score,
    chunk: {
      id: `chunk-${Math.random()}`,
      text,
      notePath: "fake/note.md",
      type: "knowledge",
      tags: "",
      source: "manual",
      updated,
    },
  };
}

// ---------------------------------------------------------------------------
// Unit tests — RetrievalPolicyStore
// ---------------------------------------------------------------------------

test("built-in policies are always available", () => {
  const store = new RetrievalPolicyStore(tmpFile("policies-builtins.json"));
  const dflt = store.get("default");
  assert(!!dflt, "default policy exists");
  assertEqual(dflt!.name, "default", "name");
  assert(store.get("proposal-drafting") !== undefined, "proposal-drafting exists");
  assert(store.get("research") !== undefined, "research exists");
  assert(store.get("email-context") !== undefined, "email-context exists");
});

test("list() returns built-in and custom policies", () => {
  const store = new RetrievalPolicyStore(tmpFile("policies-list.json"));
  store.upsert({ name: "my-policy", k: 5, boostRecent: false, boostRecentFactor: 0, includeWiki: false });
  const all = store.list();
  assert(all.some((p) => p.name === "default"), "default in list");
  assert(all.some((p) => p.name === "my-policy"), "custom in list");
});

test("upsert adds and updates a custom policy", () => {
  const store = new RetrievalPolicyStore(tmpFile("policies-upsert.json"));
  const p1 = store.upsert({ name: "custom-p", k: 10, boostRecent: false, boostRecentFactor: 0, includeWiki: false });
  assertEqual(p1.k, 10, "k=10");
  const p2 = store.upsert({ name: "custom-p", k: 20, boostRecent: false, boostRecentFactor: 0, includeWiki: false });
  assertEqual(p2.k, 20, "k updated to 20");
  assertEqual(store.get("custom-p")!.k, 20, "persisted");
});

test("upsert rejects overwriting built-in policy", () => {
  const store = new RetrievalPolicyStore(tmpFile("policies-reject.json"));
  let threw = false;
  try {
    store.upsert({ name: "default", k: 99, boostRecent: false, boostRecentFactor: 0, includeWiki: false });
  } catch {
    threw = true;
  }
  assert(threw, "threw on built-in overwrite");
});

test("delete removes custom policy", () => {
  const store = new RetrievalPolicyStore(tmpFile("policies-delete.json"));
  store.upsert({ name: "del-me", k: 3, boostRecent: false, boostRecentFactor: 0, includeWiki: false });
  const ok = store.delete("del-me");
  assert(ok, "delete returned true");
  assert(store.get("del-me") === undefined, "policy gone");
});

test("delete rejects built-in policy", () => {
  const store = new RetrievalPolicyStore(tmpFile("policies-delete-builtin.json"));
  let threw = false;
  try { store.delete("research"); } catch { threw = true; }
  assert(threw, "threw on built-in delete");
});

test("custom policies persist across store instances", () => {
  const path = tmpFile("policies-persist.json");
  const s1 = new RetrievalPolicyStore(path);
  s1.upsert({ name: "persisted-p", k: 7, boostRecent: true, boostRecentFactor: 0.1, includeWiki: false });
  const s2 = new RetrievalPolicyStore(path);
  const p = s2.get("persisted-p");
  assert(!!p, "policy found after reload");
  assertEqual(p!.k, 7, "k persisted");
});

// ---------------------------------------------------------------------------
// Unit tests — applyRecencyBoost
// ---------------------------------------------------------------------------

test("applyRecencyBoost re-orders hits by blended score", () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 100 * 86_400_000).toISOString(); // 100 days ago (recency=0)
  // With factor=0.5: old=0.6*(1+0)=0.60, recent=0.5*(1+0.5*1)=0.75 → recent wins
  const hits: RetrievalHit[] = [
    fakeHit("old content", 0.6, old),
    fakeHit("recent content", 0.5, now),
  ];
  const boosted = applyRecencyBoost(hits, 0.5);
  assertEqual(boosted[0].chunk.text, "recent content", "recent hits first after boost");
});

test("applyRecencyBoost with factor=0 leaves order unchanged", () => {
  const now = new Date().toISOString();
  const hits: RetrievalHit[] = [
    fakeHit("best", 0.9, now),
    fakeHit("second", 0.5, now),
  ];
  const unboosted = applyRecencyBoost(hits, 0);
  assertEqual(unboosted[0].chunk.text, "best", "order unchanged");
});

test("applyRecencyBoost handles missing updated field gracefully", () => {
  const hits: RetrievalHit[] = [
    fakeHit("no date", 0.8, ""),
    fakeHit("has date", 0.7, new Date().toISOString()),
  ];
  const result = applyRecencyBoost(hits, 0.3);
  assertEqual(result.length, 2, "both hits preserved");
});

// ---------------------------------------------------------------------------
// Integration tests — HTTP policy and wiki endpoints
// ---------------------------------------------------------------------------

let graphInst: ContextGraph;
let policiesInst: RetrievalPolicyStore;
let fakeSearchHits: RetrievalHit[] = [];
let fakeWikis: WikiSummary[] = [];

test("GET /policies returns all policies", async () => {
  const { status, body } = await req("GET", "/policies");
  assertEqual(status, 200, "status 200");
  assert(Array.isArray(body.policies), "policies is array");
  assert(body.policies.length >= 4, "at least 4 built-in policies");
  assert(body.policies.some((p: any) => p.name === "default"), "default present");
});

test("POST /policies creates a custom policy", async () => {
  const { status, body } = await req("POST", "/policies", {
    name: "http-custom",
    k: 7,
    boostRecent: false,
    boostRecentFactor: 0,
    includeWiki: false,
    description: "Created by test",
  });
  assertEqual(status, 201, "status 201");
  assertEqual(body.policy.name, "http-custom", "name matches");
  assertEqual(body.policy.k, 7, "k matches");
});

test("POST /policies returns 400 without name", async () => {
  const { status } = await req("POST", "/policies", { k: 5, boostRecent: false, boostRecentFactor: 0, includeWiki: false });
  assertEqual(status, 400, "status 400");
});

test("POST /policies returns 400 on built-in overwrite", async () => {
  const { status } = await req("POST", "/policies", { name: "default", k: 99, boostRecent: false, boostRecentFactor: 0, includeWiki: false });
  assertEqual(status, 400, "status 400");
});

test("DELETE /policies/:name removes custom policy", async () => {
  await req("POST", "/policies", { name: "http-delete-me", k: 3, boostRecent: false, boostRecentFactor: 0, includeWiki: false });
  const { status, body } = await req("DELETE", "/policies/http-delete-me");
  assertEqual(status, 200, "status 200");
  assert(body.ok, "ok: true");
});

test("DELETE /policies/:name returns 404 for non-existent", async () => {
  const { status } = await req("DELETE", "/policies/ghost-policy");
  assertEqual(status, 404, "status 404");
});

test("POST /wiki/preload returns entity wikis by query", async () => {
  const { status, body } = await req("POST", "/wiki/preload", { query: "proposal" });
  assertEqual(status, 200, "status 200");
  assert(Array.isArray(body.wikis), "wikis is array");
});

test("POST /wiki/preload by entityIds returns matching wikis", async () => {
  const entity = graphInst.upsertEntity({ name: "Preload test entity", type: "project", wiki: "A project entity wiki." });
  const { status, body } = await req("POST", "/wiki/preload", { entityIds: [entity.id] });
  assertEqual(status, 200, "status 200");
  assertEqual(body.wikis.length, 1, "one wiki returned");
  assertEqual(body.wikis[0].entityId, entity.id, "correct entity");
  assertEqual(body.wikis[0].wiki, "A project entity wiki.", "wiki text correct");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runRetrievalPolicyTests(): Promise<void> {
  tmpDir = join(tmpdir(), `retrieval-policy-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const graphPath = tmpFile("graph-rp.json");
  const policiesPath = tmpFile("policies-rp.json");
  graphInst = new ContextGraph(graphPath);
  policiesInst = new RetrievalPolicyStore(policiesPath);
  const workStore = new WorkMemoryStore(tmpFile("wm-rp.json"));
  const vaultPath = tmpFile("vault-rp");
  const consolidatorInst = new Consolidator(workStore, { vaultPath });

  const mockEngine = {
    // vault search
    search: async () => fakeSearchHits,
    reindex: async () => ({ notes: 0, chunks: 0 }),
    // policy-aware search
    searchWithPolicy: async (query: string, policyName: string, overrides?: any): Promise<PolicySearchResult> => {
      const p = policiesInst.get(policyName) ?? policiesInst.get("default")!;
      return { hits: fakeSearchHits, wikis: fakeWikis, policy: { ...p, ...overrides } };
    },
    // policies
    listPolicies: () => policiesInst.list(),
    upsertPolicy: (p: any) => policiesInst.upsert(p),
    deletePolicy: (name: string) => policiesInst.delete(name),
    // wiki preload
    preloadWiki: (opts: any) => {
      let entities = graphInst.listEntities();
      if (opts.entityIds?.length) entities = opts.entityIds.map((id: string) => graphInst.getEntity(id)).filter(Boolean);
      else if (opts.query) entities = graphInst.findByName(opts.query);
      const limit = opts.limit ?? 10;
      return entities.filter((e: any) => e.wiki).slice(0, limit).map((e: any) => ({ entityId: e.id, name: e.name, type: e.type, wiki: e.wiki }));
    },
    // work memory
    recordWork: (e: any) => workStore.record(e),
    queryWork: (q: any) => workStore.query(q),
    getWorkSession: (id: string) => workStore.getSession(id),
    recordCorrection: (sid: string, note: string, ref?: string) => workStore.recordCorrection(sid, note, ref),
    // consolidation
    consolidateAll: () => consolidatorInst.consolidateAll(),
    consolidateSession: (id: string) => consolidatorInst.consolidateSession(id),
    // graph
    upsertEntity: (input: any) => graphInst.upsertEntity(input),
    getEntity: (id: string) => graphInst.getEntity(id),
    removeEntity: (id: string) => graphInst.removeEntity(id),
    listEntities: () => graphInst.listEntities(),
    findEntitiesByType: (type: any) => graphInst.findByType(type),
    findEntitiesByName: (name: string) => graphInst.findByName(name),
    addEdge: (f: string, t: string, r: string, w?: number, m?: any) => graphInst.addEdge(f, t, r, w, m),
    removeEdge: (id: string) => graphInst.removeEdge(id),
    getEdges: (id?: string) => graphInst.getEdges(id),
    getNeighbors: (id: string) => graphInst.neighbors(id),
    buildEntityWiki: (id: string) => graphInst.buildWiki(id),
    buildAllWikis: () => graphInst.buildAllWikis(),
  } as unknown as MemoryEngine;

  const cfg: MemoryConfig = {
    vaultPath,
    dbPath: join(tmpDir, "lancedb"),
    workMemoryPath: tmpFile("wm-rp.json"),
    graphPath,
    policiesPath,
    ollamaUrl: "http://localhost:11434",
    embedModel: "nomic-embed-text",
    host: "127.0.0.1",
    port: 0,
    apiKey: "",
    consolidationModel: "",
  };

  httpServer = await startHttp(cfg, mockEngine);
  httpPort = (httpServer.address() as { port: number }).port;

  console.log("\n--- Retrieval Policy Tests ---");

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
  if (failed > 0) throw new Error(`${failed} retrieval policy test(s) failed`);
}

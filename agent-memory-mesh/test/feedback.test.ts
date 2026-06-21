/**
 * Tests for FeedbackStore, applyFeedbackScoring, and /feedback HTTP endpoints.
 * No Ollama or LanceDB required.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import type { Server } from "node:http";
import { FeedbackStore, applyFeedbackScoring } from "../src/memory/feedback.js";
import { WorkMemoryStore } from "../src/memory/work-memory.js";
import { ContextGraph } from "../src/memory/context-graph.js";
import { Consolidator } from "../src/memory/consolidator.js";
import { RetrievalPolicyStore } from "../src/memory/retrieval-policy.js";
import { startHttp } from "../src/service/http.js";
import type { MemoryEngine, FeedbackSignal, PolicySearchResult } from "../src/service/engine.js";
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

function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  if (Math.abs(actual - expected) > tol)
    throw new Error(`${msg} — expected ~${expected}, got ${actual}`);
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

function fakeHit(notePath: string, score: number): RetrievalHit {
  return {
    score,
    chunk: { id: `c-${Math.random()}`, text: "t", notePath, type: "k", tags: "", source: "manual", updated: "" },
  };
}

// ---------------------------------------------------------------------------
// Unit — FeedbackStore
// ---------------------------------------------------------------------------

test("upvote increments score by STEP (0.1)", () => {
  const store = new FeedbackStore(tmpFile("fb-upvote.json"));
  store.upvote("notes/alpha.md");
  assertClose(store.getScore("notes/alpha.md"), 1.1, 0.001, "score after 1 upvote");
  store.upvote("notes/alpha.md");
  assertClose(store.getScore("notes/alpha.md"), 1.2, 0.001, "score after 2 upvotes");
});

test("downvote decrements score by STEP", () => {
  const store = new FeedbackStore(tmpFile("fb-downvote.json"));
  store.downvote("notes/beta.md");
  assertClose(store.getScore("notes/beta.md"), 0.9, 0.001, "score after 1 downvote");
});

test("score is clamped to [0.1, 2.0]", () => {
  const store = new FeedbackStore(tmpFile("fb-clamp.json"));
  for (let i = 0; i < 25; i++) store.upvote("notes/high.md");
  assert(store.getScore("notes/high.md") <= 2.0, "max clamp at 2.0");
  for (let i = 0; i < 25; i++) store.downvote("notes/low.md");
  assert(store.getScore("notes/low.md") >= 0.1, "min clamp at 0.1");
});

test("unknown notePath returns default score of 1.0", () => {
  const store = new FeedbackStore(tmpFile("fb-default.json"));
  assertClose(store.getScore("never/seen.md"), 1.0, 0.001, "default score is 1.0");
});

test("signals are persisted across store instances", () => {
  const path = tmpFile("fb-persist.json");
  const s1 = new FeedbackStore(path);
  s1.upvote("notes/gamma.md", { sessionId: "s1", query: "test" });
  const s2 = new FeedbackStore(path);
  assertClose(s2.getScore("notes/gamma.md"), 1.1, 0.001, "score persisted");
  assertEqual(s2.listSignals("notes/gamma.md").length, 1, "signal persisted");
});

test("listSignals without notePath returns all signals", () => {
  const store = new FeedbackStore(tmpFile("fb-list-all.json"));
  store.upvote("notes/a.md");
  store.downvote("notes/b.md");
  const all = store.listSignals();
  assertEqual(all.length, 2, "two signals total");
});

test("summary returns top upvoted and downvoted", () => {
  const store = new FeedbackStore(tmpFile("fb-summary.json"));
  store.upvote("notes/popular.md");
  store.upvote("notes/popular.md");
  store.downvote("notes/bad.md");
  const { topUpvoted, topDownvoted, totalSignals } = store.summary();
  assertEqual(topUpvoted[0].notePath, "notes/popular.md", "top upvoted");
  assertEqual(topDownvoted[0].notePath, "notes/bad.md", "top downvoted");
  assertEqual(totalSignals, 3, "three total signals");
});

test("processedCorrectionIds tracks processed entries", () => {
  const store = new FeedbackStore(tmpFile("fb-processed.json"));
  assert(!store.isProcessed("entry-1"), "not yet processed");
  store.markProcessed(["entry-1", "entry-2"]);
  assert(store.isProcessed("entry-1"), "entry-1 processed");
  assert(store.isProcessed("entry-2"), "entry-2 processed");
});

// ---------------------------------------------------------------------------
// Unit — applyFeedbackScoring
// ---------------------------------------------------------------------------

test("applyFeedbackScoring boosts upvoted notes and penalises downvoted", () => {
  const store = new FeedbackStore(tmpFile("fb-scoring.json"));
  store.upvote("notes/good.md");
  store.downvote("notes/bad.md");
  const hits: RetrievalHit[] = [
    fakeHit("notes/bad.md", 0.9),
    fakeHit("notes/good.md", 0.5),
    fakeHit("notes/neutral.md", 0.7),
  ];
  const result = applyFeedbackScoring(hits, store);
  // good (0.5 * 1.1 = 0.55) should beat bad (0.9 * 0.9 = 0.81) — no, neutral (0.7*1.0=0.70) should be second
  // Ranked: bad=0.81, neutral=0.70, good=0.55
  assertEqual(result[0].chunk.notePath, "notes/bad.md", "highest absolute score still first");
  assertEqual(result[2].chunk.notePath, "notes/good.md", "lowest absolute score still last with these numbers");
  // Verify good beat what it would have been without feedback (just confirm scores changed)
  const goodHit = result.find((h) => h.chunk.notePath === "notes/good.md")!;
  assertClose(goodHit.score, 0.5 * 1.1, 0.001, "good note score boosted");
  const badHit = result.find((h) => h.chunk.notePath === "notes/bad.md")!;
  assertClose(badHit.score, 0.9 * 0.9, 0.001, "bad note score reduced");
});

test("applyFeedbackScoring is a no-op when all scores are 1.0", () => {
  const store = new FeedbackStore(tmpFile("fb-noop.json"));
  const hits = [fakeHit("notes/a.md", 0.9), fakeHit("notes/b.md", 0.5)];
  const result = applyFeedbackScoring(hits, store);
  assertEqual(result[0].chunk.notePath, "notes/a.md", "order unchanged");
});

// ---------------------------------------------------------------------------
// Unit — processCorrections (via WorkMemoryStore)
// ---------------------------------------------------------------------------

test("processCorrections converts correction args.notePaths to downvotes", () => {
  const wmStore = new WorkMemoryStore(tmpFile("wm-corrections.json"));
  const fbStore = new FeedbackStore(tmpFile("fb-corrections.json"));
  wmStore.record({
    sessionId: "s1",
    type: "correction",
    summary: "notes/wrong.md was unhelpful",
    correctionNote: "don't use this note",
    args: { notePaths: ["notes/wrong.md", "notes/also-wrong.md"] },
  });
  const corrections = wmStore.query({ type: "correction" });
  const unprocessed = corrections.filter((e) => !fbStore.isProcessed(e.id));
  const signals: any[] = [];
  const processedIds: string[] = [];
  for (const entry of unprocessed) {
    const notePaths: string[] = (entry.args?.notePaths as string[]) ?? [];
    for (const np of notePaths) {
      signals.push(fbStore.downvote(np, { sessionId: entry.sessionId, workMemoryEntryId: entry.id }));
    }
    processedIds.push(entry.id);
  }
  fbStore.markProcessed(processedIds);
  assertEqual(signals.length, 2, "two downvote signals created");
  assert(fbStore.getScore("notes/wrong.md") < 1.0, "wrong.md downvoted");
  assert(fbStore.getScore("notes/also-wrong.md") < 1.0, "also-wrong.md downvoted");
  assertEqual(unprocessed.filter((e) => !fbStore.isProcessed(e.id)).length, 0, "all processed");
});

// ---------------------------------------------------------------------------
// Integration — HTTP /feedback endpoints
// ---------------------------------------------------------------------------

let fbInst: FeedbackStore;
let wmInst: WorkMemoryStore;

test("POST /feedback/upvote returns signal (201)", async () => {
  const { status, body } = await req("POST", "/feedback/upvote", {
    notePath: "notes/http-test.md",
    sessionId: "http-s",
    query: "test query",
    note: "very helpful",
  });
  assertEqual(status, 201, "status 201");
  assertEqual(body.signal.vote, "up", "vote is up");
  assertEqual(body.signal.notePath, "notes/http-test.md", "notePath matches");
});

test("POST /feedback/downvote returns signal (201)", async () => {
  const { status, body } = await req("POST", "/feedback/downvote", {
    notePath: "notes/http-bad.md",
    note: "wrong info",
  });
  assertEqual(status, 201, "status 201");
  assertEqual(body.signal.vote, "down", "vote is down");
});

test("POST /feedback/upvote returns 400 without notePath", async () => {
  const { status } = await req("POST", "/feedback/upvote", { query: "something" });
  assertEqual(status, 400, "status 400");
});

test("GET /feedback/signals returns all signals", async () => {
  const { status, body } = await req("GET", "/feedback/signals");
  assertEqual(status, 200, "status 200");
  assert(Array.isArray(body.signals), "signals is array");
  assert(body.signals.length >= 2, "at least 2 signals from earlier tests");
});

test("GET /feedback/signals?notePath= filters by note", async () => {
  const { body } = await req("GET", "/feedback/signals?notePath=notes%2Fhttp-test.md");
  assert(body.signals.every((s: any) => s.notePath === "notes/http-test.md"), "all signals for that note");
});

test("GET /feedback/summary returns top lists and total", async () => {
  const { status, body } = await req("GET", "/feedback/summary");
  assertEqual(status, 200, "status 200");
  assert(Array.isArray(body.topUpvoted), "topUpvoted is array");
  assert(Array.isArray(body.topDownvoted), "topDownvoted is array");
  assert(typeof body.totalSignals === "number", "totalSignals is number");
});

test("POST /feedback/process converts corrections to downvote signals", async () => {
  wmInst.record({
    sessionId: "http-process-sess",
    type: "correction",
    summary: "vault note was wrong",
    correctionNote: "should not use this",
    args: { notePaths: ["notes/http-process-note.md"] },
  });
  const { status, body } = await req("POST", "/feedback/process");
  assertEqual(status, 200, "status 200");
  assert(typeof body.processed === "number", "processed is number");
  assert(Array.isArray(body.signals), "signals is array");
  assert(body.processed >= 1, "at least one correction processed");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runFeedbackTests(): Promise<void> {
  tmpDir = join(tmpdir(), `feedback-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const feedbackPath = tmpFile("fb-http.json");
  const workPath = tmpFile("wm-http-fb.json");
  fbInst = new FeedbackStore(feedbackPath);
  wmInst = new WorkMemoryStore(workPath);
  const graphInst = new ContextGraph(tmpFile("graph-fb.json"));
  const policiesInst = new RetrievalPolicyStore(tmpFile("policies-fb.json"));
  const vaultPath = tmpFile("vault-fb");
  const consolidatorInst = new Consolidator(wmInst, { vaultPath });

  const mockEngine = {
    search: async () => [],
    reindex: async () => ({ notes: 0, chunks: 0 }),
    searchWithPolicy: async (): Promise<PolicySearchResult> => ({ hits: [], wikis: [], policy: policiesInst.get("default")! }),
    listPolicies: () => policiesInst.list(),
    upsertPolicy: (p: any) => policiesInst.upsert(p),
    deletePolicy: (name: string) => policiesInst.delete(name),
    preloadWiki: () => [],
    submitFeedback: (notePath: string, vote: "up" | "down", opts: any) =>
      vote === "up" ? fbInst.upvote(notePath, opts) : fbInst.downvote(notePath, opts),
    listFeedbackSignals: (np?: string) => fbInst.listSignals(np),
    getFeedbackSummary: () => fbInst.summary(),
    processCorrections: () => {
      const corrections = wmInst.query({ type: "correction" });
      const unprocessed = corrections.filter((e) => !fbInst.isProcessed(e.id));
      const signals: FeedbackSignal[] = [];
      const ids: string[] = [];
      for (const entry of unprocessed) {
        for (const np of (entry.args?.notePaths as string[]) ?? []) {
          signals.push(fbInst.downvote(np, { sessionId: entry.sessionId, workMemoryEntryId: entry.id }));
        }
        ids.push(entry.id);
      }
      if (ids.length) fbInst.markProcessed(ids);
      return { processed: ids.length, signals };
    },
    recordWork: (e: any) => wmInst.record(e),
    queryWork: (q: any) => wmInst.query(q),
    getWorkSession: (id: string) => wmInst.getSession(id),
    recordCorrection: (sid: string, note: string, ref?: string) => wmInst.recordCorrection(sid, note, ref),
    consolidateAll: () => consolidatorInst.consolidateAll(),
    consolidateSession: (id: string) => consolidatorInst.consolidateSession(id),
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
    workMemoryPath: workPath,
    graphPath: tmpFile("graph-fb.json"),
    policiesPath: tmpFile("policies-fb.json"),
    feedbackPath,
    ollamaUrl: "http://localhost:11434",
    embedModel: "nomic-embed-text",
    host: "127.0.0.1",
    port: 0,
    apiKey: "",
    consolidationModel: "",
  };

  httpServer = await startHttp(cfg, mockEngine);
  httpPort = (httpServer.address() as { port: number }).port;

  console.log("\n--- Feedback Loop Tests ---");

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
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) throw new Error(`${failed} feedback test(s) failed`);
}

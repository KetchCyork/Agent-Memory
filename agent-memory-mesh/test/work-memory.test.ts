/**
 * Tests for WorkMemoryStore (unit) and /work-memory HTTP endpoints (integration).
 * No Ollama or LanceDB required — work memory is pure JSON-file backed.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import type { Server } from "node:http";
import { WorkMemoryStore } from "../src/memory/work-memory.js";
import { startHttp } from "../src/service/http.js";
import type { MemoryEngine } from "../src/service/engine.js";
import type { MemoryConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Tiny test harness
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Unit tests — WorkMemoryStore
// ---------------------------------------------------------------------------

test("record stores an entry and returns it with id + timestamp", () => {
  const store = new WorkMemoryStore(tmpFile("wm-record.json"));
  const entry = store.record({ sessionId: "s1", type: "action", summary: "did a thing" });
  assert(typeof entry.id === "string" && entry.id.length > 0, "id is set");
  assert(typeof entry.timestamp === "string", "timestamp is set");
  assertEqual(entry.sessionId, "s1", "sessionId");
  assertEqual(entry.type, "action", "type");
  assertEqual(entry.summary, "did a thing", "summary");
});

test("record persists entries across store instances", () => {
  const path = tmpFile("wm-persist.json");
  const s1 = new WorkMemoryStore(path);
  s1.record({ sessionId: "s2", type: "output", summary: "produced output" });
  const s2 = new WorkMemoryStore(path);
  const all = s2.query();
  assertEqual(all.length, 1, "one entry loaded from disk");
  assertEqual(all[0].sessionId, "s2", "sessionId after reload");
});

test("query filters by sessionId", () => {
  const store = new WorkMemoryStore(tmpFile("wm-query-session.json"));
  store.record({ sessionId: "a", type: "action", summary: "alpha" });
  store.record({ sessionId: "b", type: "action", summary: "beta" });
  const results = store.query({ sessionId: "a" });
  assertEqual(results.length, 1, "one result for session a");
  assertEqual(results[0].sessionId, "a", "sessionId is a");
});

test("query filters by type", () => {
  const store = new WorkMemoryStore(tmpFile("wm-query-type.json"));
  store.record({ sessionId: "s", type: "action", summary: "did action" });
  store.record({ sessionId: "s", type: "correction", summary: "oops", correctionNote: "oops" });
  const corrections = store.query({ type: "correction" });
  assertEqual(corrections.length, 1, "one correction");
  assertEqual(corrections[0].type, "correction", "type is correction");
});

test("query respects limit — returns last N entries", () => {
  const store = new WorkMemoryStore(tmpFile("wm-query-limit.json"));
  for (let i = 0; i < 5; i++) {
    store.record({ sessionId: "s", type: "action", summary: `step ${i}` });
  }
  const results = store.query({ limit: 2 });
  assertEqual(results.length, 2, "limit 2");
  assertEqual(results[1].summary, "step 4", "last entry is step 4");
});

test("query filters by since timestamp", async () => {
  const store = new WorkMemoryStore(tmpFile("wm-query-since.json"));
  const before = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 10));
  store.record({ sessionId: "s", type: "action", summary: "after" });
  const results = store.query({ since: before });
  assertEqual(results.length, 1, "one entry after since");
});

test("getSession returns all entries for a session", () => {
  const store = new WorkMemoryStore(tmpFile("wm-get-session.json"));
  store.record({ sessionId: "sess1", type: "action", summary: "a1" });
  store.record({ sessionId: "sess1", type: "output", summary: "o1" });
  store.record({ sessionId: "sess2", type: "action", summary: "a2" });
  const entries = store.getSession("sess1");
  assertEqual(entries.length, 2, "two entries for sess1");
  assert(entries.every((e) => e.sessionId === "sess1"), "all entries sess1");
});

test("recordCorrection creates a linked correction entry", () => {
  const store = new WorkMemoryStore(tmpFile("wm-correction.json"));
  const first = store.record({ sessionId: "s", type: "action", summary: "tried X" });
  const correction = store.recordCorrection("s", "X was wrong, use Y", first.id);
  assertEqual(correction.type, "correction", "type is correction");
  assertEqual(correction.correctionNote, "X was wrong, use Y", "correctionNote set");
  assertEqual(correction.sourceRef, first.id, "sourceRef links to original");
});

// ---------------------------------------------------------------------------
// Integration tests — HTTP /work-memory endpoints
// ---------------------------------------------------------------------------

test("POST /work-memory records an entry (201)", async () => {
  const { status, body } = await req("POST", "/work-memory", {
    sessionId: "http-s1",
    type: "action",
    summary: "http action test",
    command: "search",
    success: true,
  });
  assertEqual(status, 201, "status 201");
  assert(!!body.entry?.id, "entry has id");
  assertEqual(body.entry.sessionId, "http-s1", "sessionId matches");
  assertEqual(body.entry.type, "action", "type matches");
});

test("POST /work-memory returns 400 without sessionId", async () => {
  const { status } = await req("POST", "/work-memory", { type: "action", summary: "missing session" });
  assertEqual(status, 400, "status 400");
});

test("POST /work-memory returns 400 without type", async () => {
  const { status } = await req("POST", "/work-memory", { sessionId: "s", summary: "missing type" });
  assertEqual(status, 400, "status 400");
});

test("GET /work-memory returns all entries", async () => {
  const { status, body } = await req("GET", "/work-memory");
  assertEqual(status, 200, "status 200");
  assert(Array.isArray(body.entries), "entries is array");
});

test("GET /work-memory?sessionId= filters by session", async () => {
  await req("POST", "/work-memory", {
    sessionId: "filter-session",
    type: "output",
    summary: "filtered",
  });
  const { body } = await req("GET", "/work-memory?sessionId=filter-session");
  assert(body.entries.length >= 1, "at least one entry");
  assert(
    body.entries.every((e: any) => e.sessionId === "filter-session"),
    "all entries match session"
  );
});

test("POST /work-memory/correction records a correction (201)", async () => {
  const { status, body } = await req("POST", "/work-memory/correction", {
    sessionId: "corr-session",
    note: "should have done Y not X",
  });
  assertEqual(status, 201, "status 201");
  assertEqual(body.entry.type, "correction", "type is correction");
  assertEqual(body.entry.correctionNote, "should have done Y not X", "note set");
});

test("POST /work-memory/correction returns 400 without note", async () => {
  const { status } = await req("POST", "/work-memory/correction", { sessionId: "s" });
  assertEqual(status, 400, "status 400");
});

test("GET /work-memory/session/:id returns session entries", async () => {
  await req("POST", "/work-memory", {
    sessionId: "sess-endpoint",
    type: "signal",
    summary: "signal test",
  });
  const { status, body } = await req("GET", "/work-memory/session/sess-endpoint");
  assertEqual(status, 200, "status 200");
  assert(body.entries.length >= 1, "at least one entry");
  assert(
    body.entries.every((e: any) => e.sessionId === "sess-endpoint"),
    "all entries match session"
  );
});

// ---------------------------------------------------------------------------
// Test runner export
// ---------------------------------------------------------------------------

export async function runWorkMemoryTests(): Promise<void> {
  tmpDir = join(tmpdir(), `work-memory-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // Start HTTP server with a mock engine for endpoint tests
  const workPath = tmpFile("wm-http.json");
  const workStore = new WorkMemoryStore(workPath);
  const mockEngine = {
    recordWork: (e: any) => workStore.record(e),
    queryWork: (q: any) => workStore.query(q),
    getWorkSession: (id: string) => workStore.getSession(id),
    recordCorrection: (sid: string, note: string, ref?: string) =>
      workStore.recordCorrection(sid, note, ref),
    search: async () => [],
    reindex: async () => ({ notes: 0, chunks: 0 }),
  } as unknown as MemoryEngine;

  const cfg: MemoryConfig = {
    vaultPath: tmpDir,
    dbPath: join(tmpDir, "lancedb"),
    workMemoryPath: workPath,
    ollamaUrl: "http://localhost:11434",
    embedModel: "nomic-embed-text",
    host: "127.0.0.1",
    port: 0,
    apiKey: "",
  };

  httpServer = await startHttp(cfg, mockEngine);
  httpPort = (httpServer.address() as { port: number }).port;

  console.log("\n--- Work Memory Tests ---");

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
  if (failed > 0) throw new Error(`${failed} work memory test(s) failed`);
}

/**
 * Tests for Consolidator (unit) and /consolidate HTTP endpoints (integration).
 * Uses rule-based synthesis — no Ollama, no LanceDB required.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import type { Server } from "node:http";
import { WorkMemoryStore } from "../src/memory/work-memory.js";
import { Consolidator } from "../src/memory/consolidator.js";
import { startHttp } from "../src/service/http.js";
import type { MemoryEngine, ConsolidationResult } from "../src/service/engine.js";
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
// Unit tests — Consolidator
// ---------------------------------------------------------------------------

test("consolidateSession produces a lesson file in vault/10-inbox", async () => {
  const vaultPath = tmpFile("vault-unit");
  const workPath = tmpFile("wm-unit.json");
  const store = new WorkMemoryStore(workPath);
  store.record({ sessionId: "sess-a", type: "action", summary: "ran search", command: "search", success: true });
  store.record({ sessionId: "sess-a", type: "action", summary: "drafted reply", command: "draft", success: false });
  store.record({ sessionId: "sess-a", type: "correction", summary: "use template X", correctionNote: "use template X" });

  const consolidator = new Consolidator(store, { vaultPath });
  const result = await consolidator.consolidateSession("sess-a");

  assertEqual(result.sessionId, "sess-a", "sessionId");
  assertEqual(result.method, "rule-based", "method is rule-based (no model set)");
  assertEqual(result.entryCount, 3, "entryCount");
  assertEqual(result.successCount, 1, "successCount");
  assertEqual(result.failureCount, 1, "failureCount");
  assertEqual(result.correctionCount, 1, "correctionCount");
  assert(existsSync(result.lessonPath), "lesson file exists");
  assert(result.lessonPath.endsWith(".md"), "lesson file is markdown");
});

test("lesson file contains YAML frontmatter and session content", async () => {
  const vaultPath = tmpFile("vault-content");
  const workPath = tmpFile("wm-content.json");
  const store = new WorkMemoryStore(workPath);
  store.record({ sessionId: "sess-b", type: "action", summary: "indexed docs", success: true });
  store.record({ sessionId: "sess-b", type: "correction", summary: "skip temp files", correctionNote: "skip temp files" });

  const consolidator = new Consolidator(store, { vaultPath });
  const result = await consolidator.consolidateSession("sess-b");
  const content = readFileSync(result.lessonPath, "utf8");

  assert(content.includes("type: lesson"), "frontmatter: type: lesson");
  assert(content.includes('sessionId: "sess-b"'), "frontmatter: sessionId");
  assert(content.includes("synthesis: rule-based"), "frontmatter: synthesis");
  assert(content.includes("# Session Lesson:"), "heading");
  assert(content.includes("indexed docs"), "success entry mentioned");
  assert(content.includes("skip temp files"), "correction mentioned");
});

test("consolidateAll consolidates all sessions", async () => {
  const vaultPath = tmpFile("vault-all");
  const workPath = tmpFile("wm-all.json");
  const store = new WorkMemoryStore(workPath);
  store.record({ sessionId: "all-s1", type: "action", summary: "did X", success: true });
  store.record({ sessionId: "all-s2", type: "output", summary: "produced Y" });

  const consolidator = new Consolidator(store, { vaultPath });
  const results = await consolidator.consolidateAll();

  assertEqual(results.length, 2, "two sessions consolidated");
  const sessionIds = results.map((r) => r.sessionId).sort();
  assert(sessionIds.includes("all-s1"), "all-s1 consolidated");
  assert(sessionIds.includes("all-s2"), "all-s2 consolidated");
  assert(results.every((r) => existsSync(r.lessonPath)), "all lesson files exist");
});

test("consolidateSession is idempotent — re-run overwrites same file", async () => {
  const vaultPath = tmpFile("vault-idempotent");
  const workPath = tmpFile("wm-idempotent.json");
  const store = new WorkMemoryStore(workPath);
  store.record({ sessionId: "idem-sess", type: "action", summary: "first run", success: true });

  const consolidator = new Consolidator(store, { vaultPath });
  const r1 = await consolidator.consolidateSession("idem-sess");
  const r2 = await consolidator.consolidateSession("idem-sess");

  assertEqual(r1.lessonPath, r2.lessonPath, "same file path on second run");
  assert(existsSync(r2.lessonPath), "file still exists");
});

test("empty session produces a lesson noting zero entries", async () => {
  const vaultPath = tmpFile("vault-empty");
  const workPath = tmpFile("wm-empty.json");
  const store = new WorkMemoryStore(workPath);
  // Record for a different session so the store file exists
  store.record({ sessionId: "other", type: "action", summary: "noop" });

  const consolidator = new Consolidator(store, { vaultPath });
  const result = await consolidator.consolidateSession("nonexistent-sess");

  assert(existsSync(result.lessonPath), "lesson file written even for empty session");
  assertEqual(result.entryCount, 0, "entryCount is 0");
});

// ---------------------------------------------------------------------------
// Integration tests — HTTP /consolidate endpoints
// ---------------------------------------------------------------------------

let httpStore: WorkMemoryStore;

test("POST /consolidate returns results array", async () => {
  httpStore.record({ sessionId: "http-c1", type: "action", summary: "http action", success: true });
  const { status, body } = await req("POST", "/consolidate");
  assertEqual(status, 200, "status 200");
  assert(Array.isArray(body.results), "results is array");
  assert(body.results.length >= 1, "at least one result");
  assert(body.results.every((r: any) => r.sessionId && r.lessonPath), "results have expected shape");
});

test("POST /consolidate/:sessionId consolidates one session", async () => {
  httpStore.record({ sessionId: "http-c2", type: "output", summary: "generated output" });
  const { status, body } = await req("POST", "/consolidate/http-c2");
  assertEqual(status, 200, "status 200");
  assertEqual(body.result.sessionId, "http-c2", "sessionId matches");
  assert(body.result.lessonPath, "lessonPath is set");
  assertEqual(body.result.method, "rule-based", "rule-based synthesis");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runConsolidatorTests(): Promise<void> {
  tmpDir = join(tmpdir(), `consolidator-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // Start HTTP server with a mock engine
  const workPath = tmpFile("wm-http-c.json");
  httpStore = new WorkMemoryStore(workPath);
  const vaultPath = tmpFile("vault-http");
  const consolidatorInst = new Consolidator(httpStore, { vaultPath });

  const mockEngine = {
    recordWork: (e: any) => httpStore.record(e),
    queryWork: (q: any) => httpStore.query(q),
    getWorkSession: (id: string) => httpStore.getSession(id),
    recordCorrection: (sid: string, note: string, ref?: string) =>
      httpStore.recordCorrection(sid, note, ref),
    consolidateAll: () => consolidatorInst.consolidateAll(),
    consolidateSession: (id: string) => consolidatorInst.consolidateSession(id),
    search: async () => [],
    reindex: async () => ({ notes: 0, chunks: 0 }),
  } as unknown as MemoryEngine;

  const cfg: MemoryConfig = {
    vaultPath,
    dbPath: join(tmpDir, "lancedb"),
    workMemoryPath: workPath,
    ollamaUrl: "http://localhost:11434",
    embedModel: "nomic-embed-text",
    host: "127.0.0.1",
    port: 0,
    apiKey: "",
    consolidationModel: "",
  };

  httpServer = await startHttp(cfg, mockEngine);
  httpPort = (httpServer.address() as { port: number }).port;

  console.log("\n--- Consolidator Tests ---");

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
  if (failed > 0) throw new Error(`${failed} consolidator test(s) failed`);
}

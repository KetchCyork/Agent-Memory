import assert from "node:assert/strict";
import { MetricsCollector } from "../src/service/metrics.js";

export async function runMetricsTests(): Promise<void> {
  console.log("  [metrics] running...");

  const m = new MetricsCollector();

  // Fresh collector has zero counts
  let snap = m.snapshot();
  assert.equal(snap.searchCount, 0);
  assert.equal(snap.avgSearchLatencyMs, 0);

  // recordSearch increments count and latency
  m.recordSearch(50);
  m.recordSearch(100);
  snap = m.snapshot();
  assert.equal(snap.searchCount, 2);
  assert.equal(snap.totalSearchLatencyMs, 150);
  assert.equal(snap.avgSearchLatencyMs, 75);
  assert.equal(snap.searchErrors, 0);

  // error flag increments error count
  m.recordSearch(20, true);
  snap = m.snapshot();
  assert.equal(snap.searchErrors, 1);

  // recordIndex
  m.recordIndex(200);
  snap = m.snapshot();
  assert.equal(snap.indexCount, 1);
  assert.equal(snap.totalIndexLatencyMs, 200);
  assert.equal(snap.indexErrors, 0);

  m.recordIndex(10, true);
  snap = m.snapshot();
  assert.equal(snap.indexErrors, 1);

  // other counters
  m.recordWorkMemory();
  m.recordWorkMemory();
  m.recordConsolidation();
  m.recordFeedback();
  snap = m.snapshot();
  assert.equal(snap.workMemoryCount, 2);
  assert.equal(snap.consolidationCount, 1);
  assert.equal(snap.feedbackCount, 1);

  // uptimeMs is non-negative
  assert.ok(snap.uptimeMs >= 0);
  assert.ok(snap.startedAt.length > 0);

  // reset clears everything
  m.reset();
  snap = m.snapshot();
  assert.equal(snap.searchCount, 0);
  assert.equal(snap.indexCount, 0);
  assert.equal(snap.workMemoryCount, 0);
  assert.equal(snap.avgSearchLatencyMs, 0);

  console.log("  [metrics] all tests passed");
}

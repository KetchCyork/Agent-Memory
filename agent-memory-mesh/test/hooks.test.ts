import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { HooksEngine } from "../src/memory/hooks.js";

function makeTmpFile(): string {
  const dir = join(tmpdir(), "hooks-test-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  return join(dir, "hooks.json");
}

export async function runHooksTests(): Promise<void> {
  console.log("  [hooks] running...");

  const filePath = makeTmpFile();
  const engine = new HooksEngine(filePath);

  // Empty state
  assert.deepEqual(engine.listRules(), []);
  assert.deepEqual(engine.listHistory(), []);

  // addRule
  const rule = engine.addRule({
    name: "slow-search",
    event: "search",
    action: "log",
    condition: { minLatencyMs: 500 },
    enabled: true,
  });
  assert.ok(rule.id);
  assert.ok(rule.createdAt);
  assert.equal(rule.name, "slow-search");

  // listRules
  assert.equal(engine.listRules().length, 1);

  // getRule
  assert.equal(engine.getRule(rule.id)?.name, "slow-search");
  assert.equal(engine.getRule("nope"), undefined);

  // fire — below threshold, should not trigger
  let fired = engine.fire("search", { query: "test", latencyMs: 100 });
  assert.equal(fired.length, 0);
  assert.equal(engine.listHistory().length, 0);

  // fire — at threshold, should trigger
  fired = engine.fire("search", { query: "test", latencyMs: 600 });
  assert.equal(fired.length, 1);
  assert.equal(fired[0].ruleId, rule.id);
  assert.equal(fired[0].event, "search");
  assert.equal(engine.listHistory().length, 1);

  // wrong event does not fire
  fired = engine.fire("reindex", { latencyMs: 1000 });
  assert.equal(fired.length, 0);

  // disabled rule does not fire
  engine.updateRule(rule.id, { enabled: false });
  fired = engine.fire("search", { query: "x", latencyMs: 1000 });
  assert.equal(fired.length, 0);

  // re-enable
  engine.updateRule(rule.id, { enabled: true });
  fired = engine.fire("search", { query: "x", latencyMs: 1000 });
  assert.equal(fired.length, 1);

  // onError condition
  const errRule = engine.addRule({ name: "on-err", event: "search", action: "log", condition: { onError: true }, enabled: true });
  fired = engine.fire("search", { query: "x", latencyMs: 0 }); // no error field → should not fire errRule
  const errFires = fired.filter((f) => f.ruleId === errRule.id);
  assert.equal(errFires.length, 0);
  fired = engine.fire("search", { query: "x", latencyMs: 0, error: "timeout" });
  const errFires2 = fired.filter((f) => f.ruleId === errRule.id);
  assert.equal(errFires2.length, 1);

  // pattern condition
  const patRule = engine.addRule({ name: "pattern-match", event: "feedback", action: "log", condition: { pattern: "importantNote" }, enabled: true });
  fired = engine.fire("feedback", { notePath: "importantNote.md", vote: "down" });
  assert.equal(fired.filter((f) => f.ruleId === patRule.id).length, 1);
  fired = engine.fire("feedback", { notePath: "other.md", vote: "down" });
  assert.equal(fired.filter((f) => f.ruleId === patRule.id).length, 0);

  // listHistory by ruleId
  const hist = engine.listHistory(rule.id);
  assert.ok(hist.length >= 2);
  assert.ok(hist.every((h) => h.ruleId === rule.id));

  // removeRule
  const ok = engine.removeRule(rule.id);
  assert.equal(ok, true);
  assert.equal(engine.getRule(rule.id), undefined);
  assert.equal(engine.removeRule("nope"), false);

  // persistence across instances
  const rule2 = engine.addRule({ name: "persist-test", event: "consolidation", action: "log", enabled: true });
  const engine2 = new HooksEngine(filePath);
  assert.ok(engine2.getRule(rule2.id));
  assert.equal(engine2.getRule(rule2.id)?.name, "persist-test");

  // history bounded to 200 entries (fire many times)
  const bulkRule = engine2.addRule({ name: "bulk", event: "work-memory", action: "log", enabled: true });
  for (let i = 0; i < 210; i++) {
    engine2.fire("work-memory", { type: "action", sessionId: "s1", entryId: String(i) });
  }
  const fullHistory = engine2.listHistory();
  assert.ok(fullHistory.length <= 200);

  console.log("  [hooks] all tests passed");
}

import { ScoringStore } from "../src/memory/scoring.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export async function runScoringTests() {
  const file = join(tmpdir(), `scoring-test-${randomUUID()}.json`);
  const store = new ScoringStore(file);
  const cfg = { decayEnabled: true, decayHalfLifeDays: 30, minScore: 0.05 };

  const entry = store.recordAccess("notes/foo.md");
  console.assert(entry.accessCount === 1, "accessCount should be 1");
  console.assert(entry.score === 1.0, "score should be 1.0 after access");

  const entry2 = store.recordAccess("notes/foo.md");
  console.assert(entry2.accessCount === 2, "accessCount should be 2");

  const score = store.getDecayedScore("notes/foo.md", cfg);
  console.assert(score >= 0.99, `Score should be ~1.0 immediately, got ${score}`);

  console.assert(store.getDecayedScore("notes/unseen.md", cfg) === 1.0, "unseen note = 1.0");
  console.assert(
    store.getDecayedScore("notes/foo.md", { ...cfg, decayEnabled: false }) === 1.0,
    "disabled decay = 1.0"
  );

  // Test applyDecayScores: stale note with 90-day-old lastAccessedAt should sink
  const staleFile = join(tmpdir(), `scoring-stale-${randomUUID()}.json`);
  const staleDate = new Date(Date.now() - 90 * 86400000).toISOString();
  writeFileSync(
    staleFile,
    JSON.stringify([
      {
        notePath: "notes/stale.md",
        score: 1.0,
        accessCount: 1,
        lastAccessedAt: staleDate,
        createdAt: staleDate,
      },
    ])
  );
  const staleStore = new ScoringStore(staleFile);
  const hits = [
    { chunk: { notePath: "notes/stale.md", text: "old", source: "vault" }, score: 0.9 },
    { chunk: { notePath: "notes/fresh.md", text: "new", source: "vault" }, score: 0.5 },
  ];
  const sorted = staleStore.applyDecayScores(hits as any, cfg);
  console.assert(
    sorted[0].chunk.notePath === "notes/fresh.md",
    `Fresh note should win after decay, got ${sorted[0].chunk.notePath}`
  );

  // Decay disabled: order unchanged
  const unsorted = staleStore.applyDecayScores(hits as any, { ...cfg, decayEnabled: false });
  console.assert(
    unsorted[0].chunk.notePath === "notes/stale.md",
    "Decay disabled: original order preserved"
  );

  // Persistence across reload
  const store2 = new ScoringStore(file);
  console.assert(store2.listScores().length > 0, "Scores persist across reload");

  console.log("[scoring] All tests passed");
}

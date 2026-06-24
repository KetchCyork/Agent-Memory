import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SnapshotStore } from "../src/memory/snapshots.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), "snap-test-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function runSnapshotsTests(): Promise<void> {
  console.log("  [snapshots] running...");

  const snapshotsDir = makeTmpDir();
  const sourceDir = makeTmpDir();
  const store = new SnapshotStore(snapshotsDir);

  const wmPath = join(sourceDir, "work-memory.json");
  const gPath = join(sourceDir, "graph.json");
  const fbPath = join(sourceDir, "feedback.json");
  writeFileSync(wmPath, JSON.stringify([{ id: "e1" }]));
  writeFileSync(gPath, JSON.stringify({ entities: [] }));
  writeFileSync(fbPath, JSON.stringify({ signals: [] }));

  // create snapshot
  const manifest = await store.create({
    workMemoryPath: wmPath,
    graphPath: gPath,
    feedbackPath: fbPath,
    label: "test-snap",
  });
  assert.ok(manifest.id);
  assert.equal(manifest.label, "test-snap");
  assert.ok(existsSync(manifest.files.workMemoryCopy));
  assert.ok(existsSync(manifest.files.graphCopy));
  assert.ok(existsSync(manifest.files.feedbackCopy));

  // list returns the snapshot
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, manifest.id);

  // get by id
  const fetched = store.get(manifest.id);
  assert.ok(fetched);
  assert.equal(fetched.label, "test-snap");

  // get non-existent
  assert.equal(store.get("non-existent-id"), undefined);

  // create second snapshot for ordering
  await store.create({ workMemoryPath: wmPath, graphPath: gPath, feedbackPath: fbPath, label: "snap2" });
  const list2 = store.list();
  assert.equal(list2.length, 2);
  // newest first
  assert.equal(list2[0].label, "snap2");

  // restore — mutate the source files then verify restore brings them back
  writeFileSync(wmPath, JSON.stringify([{ id: "e1" }, { id: "e2" }]));
  await store.restore(manifest.id);
  const restored = JSON.parse(readFileSync(wmPath, "utf8"));
  assert.equal(restored.length, 1); // back to original single entry

  // restore auto-creates a safety snapshot (so count is now 4: original + snap2 + safety)
  const list3 = store.list();
  assert.ok(list3.length >= 3);
  const safetySnap = list3.find((s) => s.label?.startsWith("pre-restore-"));
  assert.ok(safetySnap);

  // delete
  const ok = store.delete(manifest.id);
  assert.equal(ok, true);
  assert.equal(store.get(manifest.id), undefined);

  // delete non-existent returns false
  assert.equal(store.delete("does-not-exist"), false);

  // missing source file handled gracefully (safeCopy writes empty array)
  const missingPath = join(sourceDir, "missing.json");
  const manifest2 = await store.create({
    workMemoryPath: missingPath,
    graphPath: gPath,
    feedbackPath: fbPath,
  });
  const copyContent = readFileSync(manifest2.files.workMemoryCopy, "utf8");
  assert.equal(copyContent, "[]");

  console.log("  [snapshots] all tests passed");
}

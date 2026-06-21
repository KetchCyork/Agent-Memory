import { ProvenanceStore } from "../src/memory/provenance.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export async function runProvenanceTests() {
  const file = join(tmpdir(), `provenance-test-${randomUUID()}.json`);
  const store = new ProvenanceStore(file);

  const rec = store.record({ notePath: "notes/foo.md", source: "vault", ingestedBy: "test-agent" });
  console.assert(rec.id.length > 0, "id generated");
  console.assert(rec.ingestedAt.length > 0, "ingestedAt set");
  console.assert(rec.notePath === "notes/foo.md", "notePath correct");
  console.assert(rec.source === "vault", "source correct");

  const byPath = store.getByNotePath("notes/foo.md");
  console.assert(byPath.length === 1, `getByNotePath should return 1, got ${byPath.length}`);
  console.assert(store.getByNotePath("notes/bar.md").length === 0, "unknown path returns 0");

  store.record({ notePath: "notes/bar.md", source: "remote", remoteNodeId: "node-abc", remoteConnector: "onedrive" });

  console.assert(store.list({ source: "vault" }).length === 1, "filter by source=vault");
  console.assert(store.list({ source: "remote" }).length === 1, "filter by source=remote");
  console.assert(store.list({ remoteNodeId: "node-abc" }).length === 1, "filter by remoteNodeId");

  const future = new Date(Date.now() + 86400000).toISOString();
  console.assert(store.list({ since: future }).length === 0, "filter by future since returns 0");
  console.assert(store.list({ notePath: "notes/foo.md" }).length === 1, "filter by notePath");

  const byNode = store.listByRemoteNode("node-abc");
  console.assert(byNode.length === 1, `listByRemoteNode should return 1, got ${byNode.length}`);

  // summaryByNode
  store.record({ notePath: "notes/baz.md", source: "remote", remoteNodeId: "node-abc" });
  const summary = store.summaryByNode();
  const nodeEntry = summary.find((s) => s.remoteNodeId === "node-abc");
  console.assert(nodeEntry !== undefined, "node-abc in summary");
  console.assert(nodeEntry!.count === 2, `count should be 2, got ${nodeEntry!.count}`);
  console.assert(nodeEntry!.lastSync.length > 0, "lastSync set");

  // delete
  console.assert(store.delete(rec.id) === true, "delete returns true");
  console.assert(store.delete("nonexistent-id") === false, "delete nonexistent returns false");
  console.assert(store.getByNotePath("notes/foo.md").length === 0, "deleted record gone");

  // Persistence
  const store2 = new ProvenanceStore(file);
  console.assert(store2.list().length > 0, "records persist across reload");

  console.log("[provenance] All tests passed");
}

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NodeRegistry } from "../src/memory/node-registry.js";

function makeTmpFile(): string {
  const dir = join(tmpdir(), "node-reg-test-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  return join(dir, "registry.json");
}

export async function runNodeRegistryTests(): Promise<void> {
  console.log("  [node-registry] running...");

  const filePath = makeTmpFile();
  const registry = new NodeRegistry(filePath);

  // Empty registry
  assert.deepEqual(registry.list(), []);

  // register a node
  const node = registry.register({
    name: "macbook-hq",
    address: "100.64.0.1",
    capabilities: ["local-model", "memory"],
    metadata: { os: "macOS" },
  });
  assert.ok(node.id);
  assert.equal(node.name, "macbook-hq");
  assert.equal(node.status, "online");
  assert.ok(node.registeredAt);
  assert.ok(node.lastHeartbeatAt);

  // list returns the node
  assert.equal(registry.list().length, 1);

  // get by id
  assert.equal(registry.get(node.id)?.name, "macbook-hq");
  assert.equal(registry.get("no-such-id"), undefined);

  // getByName
  assert.equal(registry.getByName("macbook-hq")?.id, node.id);
  assert.equal(registry.getByName("nope"), undefined);

  // re-register is idempotent (updates in place, same id)
  const updated = registry.register({
    name: "macbook-hq",
    address: "100.64.0.2",
    capabilities: ["local-model", "memory", "shell"],
  });
  assert.equal(updated.id, node.id);
  assert.equal(updated.address, "100.64.0.2");
  assert.equal(registry.list().length, 1);

  // register second node
  const node2 = registry.register({
    name: "windows-laptop",
    address: "100.64.0.3",
    capabilities: ["m365", "memory"],
  });

  // filter by capability
  const memNodes = registry.findByCapability("memory");
  assert.equal(memNodes.length, 2);
  const m365Nodes = registry.findByCapability("m365");
  assert.equal(m365Nodes.length, 1);
  assert.equal(m365Nodes[0].name, "windows-laptop");

  // filter by status
  assert.equal(registry.list({ status: "online" }).length, 2);
  assert.equal(registry.list({ status: "offline" }).length, 0);

  // heartbeat
  const hbOk = registry.heartbeat(node.id);
  assert.equal(hbOk, true);
  assert.equal(registry.heartbeat("nope"), false);

  // deregister marks offline but keeps the record
  const deOk = registry.deregister(node.id);
  assert.equal(deOk, true);
  assert.equal(registry.get(node.id)?.status, "offline");
  assert.equal(registry.list({ status: "offline" }).length, 1);

  // offline nodes not returned by findByCapability
  const memOnline = registry.findByCapability("memory");
  assert.equal(memOnline.length, 1); // only node2 is online

  // deregister non-existent
  assert.equal(registry.deregister("nope"), false);

  // remove hard-deletes
  const rmOk = registry.remove(node.id);
  assert.equal(rmOk, true);
  assert.equal(registry.get(node.id), undefined);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.remove("nope"), false);

  // persistence across instances
  const registry2 = new NodeRegistry(filePath);
  assert.equal(registry2.list().length, 1);
  assert.equal(registry2.get(node2.id)?.name, "windows-laptop");

  // filter by capability via list()
  const capList = registry2.list({ capability: "m365" });
  assert.equal(capList.length, 1);

  console.log("  [node-registry] all tests passed");
}

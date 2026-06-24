/** inspect — display current memory state statistics. */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { MemoryEngine } from "../service/engine.js";

async function main() {
  const cfg = loadConfig();
  const engine = new MemoryEngine(cfg);
  const stats = engine.getStats();

  console.log("=== Agent Memory Inspect ===\n");
  console.log(`Work memory`);
  console.log(`  Entries  : ${stats.workMemory.total}`);
  console.log(`  Sessions : ${stats.workMemory.sessions}`);
  console.log("");
  console.log(`Context graph`);
  console.log(`  Entities : ${stats.graph.entities}`);
  console.log(`  Edges    : ${stats.graph.edges}`);
  console.log("");
  console.log(`Feedback`);
  console.log(`  Signals  : ${stats.feedback.signals}`);
  console.log(`  Upvotes  : ${stats.feedback.upvotes}`);
  console.log(`  Downvotes: ${stats.feedback.downvotes}`);
  console.log("");
  console.log(`Retrieval policies : ${stats.policies.total}`);
  console.log(`Hook rules         : ${stats.hooks.rules}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

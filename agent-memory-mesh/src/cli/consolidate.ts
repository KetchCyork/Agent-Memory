/** consolidate — synthesise work memory sessions into vault lesson notes. */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { WorkMemoryStore } from "../memory/work-memory.js";
import { Consolidator } from "../memory/consolidator.js";

async function main() {
  const cfg = loadConfig();
  const store = new WorkMemoryStore(cfg.workMemoryPath);
  const consolidator = new Consolidator(store, {
    vaultPath: cfg.vaultPath,
    ollamaUrl: cfg.ollamaUrl,
    consolidationModel: cfg.consolidationModel || undefined,
  });

  const sessionId = process.argv[2];

  if (sessionId) {
    console.log(`Consolidating session: ${sessionId}`);
    const result = await consolidator.consolidateSession(sessionId);
    console.log(`✓ Lesson written → ${result.lessonPath}`);
    console.log(`  ${result.entryCount} entries | ${result.successCount} successes | ${result.failureCount} failures | ${result.correctionCount} corrections | method: ${result.method}`);
  } else {
    console.log("Consolidating all sessions...");
    const results = await consolidator.consolidateAll();
    if (!results.length) {
      console.log("No sessions found in work memory.");
    } else {
      for (const r of results) {
        console.log(`✓ "${r.sessionId}" → ${r.lessonPath} (${r.entryCount} entries, ${r.method})`);
      }
      console.log(`\nDone. ${results.length} session(s) consolidated.`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

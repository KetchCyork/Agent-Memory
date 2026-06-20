/** index — build/refresh the memory index from the vault. */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { MemoryEngine } from "../service/engine.js";

async function main() {
  const cfg = loadConfig();
  console.log(`Vault: ${cfg.vaultPath}\nIndex: ${cfg.dbPath}`);
  const engine = new MemoryEngine(cfg);
  const res = await engine.reindex((m) => console.log("  " + m));
  console.log(`\nDone: ${res.notes} notes, ${res.chunks} chunks.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

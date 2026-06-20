/** serve — start the memory service (HTTP, and MCP stdio if --mcp). */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { MemoryEngine } from "../service/engine.js";
import { startHttp } from "../service/http.js";
import { startMcpStdio } from "../service/mcp.js";

async function main() {
  const cfg = loadConfig();
  const engine = new MemoryEngine(cfg);
  if (process.argv.includes("--mcp")) {
    await startMcpStdio(cfg, engine);   // stdio: keep stdout clean for the protocol
  } else {
    startHttp(cfg, engine);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

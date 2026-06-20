/** graph — inspect and manage the context graph from the CLI. */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { ContextGraph } from "../memory/context-graph.js";

async function main() {
  const cfg = loadConfig();
  const graph = new ContextGraph(cfg.graphPath, {
    ollamaUrl: cfg.ollamaUrl,
    wikiModel: cfg.consolidationModel || undefined,
  });

  const [cmd, arg] = process.argv.slice(2);

  switch (cmd) {
    case "list": {
      const entities = graph.listEntities();
      if (!entities.length) { console.log("No entities in graph."); break; }
      for (const e of entities) {
        const neighbors = graph.neighbors(e.id);
        const connStr = neighbors.length
          ? ` → [${neighbors.map((n) => n.entity.name).join(", ")}]`
          : "";
        console.log(`[${e.type}] ${e.name} (${e.id})${connStr}`);
        if (e.wiki) console.log(`  ${e.wiki}`);
      }
      break;
    }
    case "show": {
      if (!arg) { console.error("Usage: npm run graph -- show <entityId>"); process.exit(1); }
      const entity = graph.getEntity(arg);
      if (!entity) { console.error(`Entity not found: ${arg}`); process.exit(1); }
      console.log(JSON.stringify(entity, null, 2));
      const neighbors = graph.neighbors(arg);
      if (neighbors.length) {
        console.log("\nNeighbors:");
        for (const n of neighbors)
          console.log(`  [${n.direction}] ${n.relation} → ${n.entity.name} (${n.entity.type})`);
      }
      break;
    }
    case "wiki": {
      if (!arg) {
        const count = await graph.buildAllWikis();
        console.log(`Built wikis for ${count} entities.`);
      } else {
        const entity = await graph.buildWiki(arg);
        console.log(`Wiki for ${entity.name}:\n${entity.wiki}`);
      }
      break;
    }
    default:
      console.log("Usage:");
      console.log("  npm run graph -- list              # list all entities");
      console.log("  npm run graph -- show <id>         # show entity + neighbors");
      console.log("  npm run graph -- wiki [id]         # build wiki for one or all entities");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

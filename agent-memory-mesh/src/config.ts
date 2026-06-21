/**
 * Config for the memory service.
 * Reads .env (see .env.example). Sensible local-first defaults.
 */
import { homedir } from "node:os";
import { join } from "node:path";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export interface MemoryConfig {
  vaultPath: string;
  dbPath: string;
  /** JSON file path for the episodic work memory log. */
  workMemoryPath: string;
  /** JSON file path for the context graph (entities + edges). */
  graphPath: string;
  /** JSON file path for custom retrieval policies. */
  policiesPath: string;
  /** JSON file path for per-note feedback signals and scores. */
  feedbackPath: string;
  ollamaUrl: string;
  embedModel: string;
  /** Bind host. 0.0.0.0 exposes on all interfaces; prefer the tailnet IP/name. */
  host: string;
  port: number;
  /** Optional shared secret required on every request (X-Api-Key header). */
  apiKey: string;
  /**
   * Ollama model for LLM-based session synthesis during consolidation.
   * Leave empty for rule-based synthesis (no LLM required).
   */
  consolidationModel: string;
  /** JSON file path for per-note access scores and decay tracking. */
  scoringPath: string;
  /** Enable exponential time-decay on memory chunk scores. */
  decayEnabled: boolean;
  /** Half-life in days for the decay formula (score halves every N days). */
  decayHalfLifeDays: number;
  /** Enable LRU in-memory cache for search results. */
  searchCacheEnabled: boolean;
  /** Maximum number of search results to cache. */
  searchCacheSize: number;
  /** Cache TTL in milliseconds. */
  searchCacheTtlMs: number;
  /** Directory for memory state snapshots. */
  snapshotsDir: string;
  /** JSON file path for provenance records. */
  provenancePath: string;
  /** JSON file path for hook rules and alerts. */
  hooksStatePath: string;
  /** JSON file path for remote node registry. */
  nodeRegistryPath: string;
}

export function loadConfig(): MemoryConfig {
  const base = join(homedir(), ".agent-memory-mesh");
  return {
    vaultPath: env("VAULT_PATH") || join(base, "vault"),
    dbPath: env("MEMORY_DB_PATH") || join(base, "memory.lancedb"),
    workMemoryPath: env("WORK_MEMORY_PATH") || join(base, "work-memory.json"),
    graphPath: env("GRAPH_PATH") || join(base, "context-graph.json"),
    policiesPath: env("POLICIES_PATH") || join(base, "retrieval-policies.json"),
    feedbackPath: env("FEEDBACK_PATH") || join(base, "feedback.json"),
    ollamaUrl: env("OLLAMA_URL", "http://localhost:11434"),
    embedModel: env("EMBED_MODEL", "nomic-embed-text"),
    // Default to loopback for safety; set MEMORY_HOST to the tailnet name to share.
    host: env("MEMORY_HOST", "127.0.0.1"),
    port: Number(env("MEMORY_PORT", "8377")),
    apiKey: env("MEMORY_API_KEY", ""),
    consolidationModel: env("CONSOLIDATION_MODEL", ""),
    scoringPath: env("SCORING_PATH") || join(base, "scoring.json"),
    decayEnabled: env("DECAY_ENABLED") === "true",
    decayHalfLifeDays: Number(env("DECAY_HALF_LIFE_DAYS", "30")),
    searchCacheEnabled: env("SEARCH_CACHE_ENABLED") !== "false",
    searchCacheSize: Number(env("SEARCH_CACHE_SIZE", "100")),
    searchCacheTtlMs: Number(env("SEARCH_CACHE_TTL_MS", "60000")),
    snapshotsDir: env("SNAPSHOTS_DIR") || join(base, "snapshots"),
    provenancePath: env("PROVENANCE_PATH") || join(base, "provenance.json"),
    hooksStatePath: env("HOOKS_STATE_PATH") || join(base, "hooks.json"),
    nodeRegistryPath: env("NODE_REGISTRY_PATH") || join(base, "nodes.json"),
  };
}

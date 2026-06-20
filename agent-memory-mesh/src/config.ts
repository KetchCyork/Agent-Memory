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
  ollamaUrl: string;
  embedModel: string;
  /** Bind host. 0.0.0.0 exposes on all interfaces; prefer the tailnet IP/name. */
  host: string;
  port: number;
  /** Optional shared secret required on every request (X-Api-Key header). */
  apiKey: string;
}

export function loadConfig(): MemoryConfig {
  const base = join(homedir(), ".agent-memory-mesh");
  return {
    vaultPath: env("VAULT_PATH") || join(base, "vault"),
    dbPath: env("MEMORY_DB_PATH") || join(base, "memory.lancedb"),
    ollamaUrl: env("OLLAMA_URL", "http://localhost:11434"),
    embedModel: env("EMBED_MODEL", "nomic-embed-text"),
    // Default to loopback for safety; set MEMORY_HOST to the tailnet name to share.
    host: env("MEMORY_HOST", "127.0.0.1"),
    port: Number(env("MEMORY_PORT", "8377")),
    apiKey: env("MEMORY_API_KEY", ""),
  };
}

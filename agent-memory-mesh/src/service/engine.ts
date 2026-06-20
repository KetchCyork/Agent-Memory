/**
 * Memory engine
 * -------------
 * Thin wrapper that wires the embedder + LanceDB store + indexer together and
 * exposes the two operations every agent needs over the mesh: search and index.
 * Both the HTTP API and the MCP server call this, so behavior stays identical
 * no matter how an agent reaches the brain.
 */

import type { MemoryConfig } from "../config.js";
import { Embedder } from "../memory/embeddings.js";
import { MemoryStore, type RetrievalHit } from "../memory/store.js";
import { Indexer, type IndexResult } from "../memory/indexer.js";

export class MemoryEngine {
  private embedder: Embedder;
  private store: MemoryStore;
  private opened = false;

  constructor(private cfg: MemoryConfig) {
    this.embedder = new Embedder({ ollamaUrl: cfg.ollamaUrl, model: cfg.embedModel });
    this.store = new MemoryStore(cfg.dbPath);
  }

  /** Open the store lazily, sizing the table from a probe embedding the first time. */
  private async ensureOpen(): Promise<void> {
    if (this.opened) return;
    const probe = await this.embedder.embed("dimension probe");
    await this.store.open(probe.length);
    this.opened = true;
  }

  /** Hybrid (vector + keyword) search. Optional metadata filter, e.g. type/tags. */
  async search(query: string, k = 8, filter?: string): Promise<RetrievalHit[]> {
    await this.ensureOpen();
    const qvec = await this.embedder.embed(query);
    return this.store.retrieve(query, qvec, k, filter);
  }

  /** Rebuild the index from the vault. */
  async reindex(onProgress?: (m: string) => void): Promise<IndexResult> {
    const indexer = new Indexer(this.cfg.vaultPath, this.store, this.embedder);
    const res = await indexer.indexAll(onProgress);
    this.opened = true; // indexer opens the store as part of its run
    return res;
  }
}

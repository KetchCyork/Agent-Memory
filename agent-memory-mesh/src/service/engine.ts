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
import { WorkMemoryStore, type WorkMemoryEntry, type WorkMemoryQuery } from "../memory/work-memory.js";
import { Consolidator, type ConsolidationResult } from "../memory/consolidator.js";
import { ContextGraph, type ContextGraphEntity, type ContextGraphEdge, type EntityType, type NeighborResult } from "../memory/context-graph.js";

export { type WorkMemoryEntry, type WorkMemoryQuery, type ConsolidationResult, type ContextGraphEntity, type ContextGraphEdge, type EntityType, type NeighborResult };

export class MemoryEngine {
  private embedder: Embedder;
  private store: MemoryStore;
  private workMemory: WorkMemoryStore;
  private consolidator: Consolidator;
  private graph: ContextGraph;
  private opened = false;

  constructor(private cfg: MemoryConfig) {
    this.embedder = new Embedder({ ollamaUrl: cfg.ollamaUrl, model: cfg.embedModel });
    this.store = new MemoryStore(cfg.dbPath);
    this.workMemory = new WorkMemoryStore(cfg.workMemoryPath);
    this.consolidator = new Consolidator(this.workMemory, {
      vaultPath: cfg.vaultPath,
      ollamaUrl: cfg.ollamaUrl,
      consolidationModel: cfg.consolidationModel || undefined,
    });
    this.graph = new ContextGraph(cfg.graphPath, {
      ollamaUrl: cfg.ollamaUrl,
      wikiModel: cfg.consolidationModel || undefined,
    });
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

  // Work memory — episodic record of agent actions, outputs, and corrections.

  recordWork(entry: Omit<WorkMemoryEntry, "id" | "timestamp">): WorkMemoryEntry {
    return this.workMemory.record(entry);
  }

  queryWork(q: WorkMemoryQuery = {}): WorkMemoryEntry[] {
    return this.workMemory.query(q);
  }

  getWorkSession(sessionId: string): WorkMemoryEntry[] {
    return this.workMemory.getSession(sessionId);
  }

  recordCorrection(sessionId: string, note: string, sourceEntryId?: string): WorkMemoryEntry {
    return this.workMemory.recordCorrection(sessionId, note, sourceEntryId);
  }

  // Consolidation — synthesise sessions into vault lesson notes.

  async consolidateAll(): Promise<ConsolidationResult[]> {
    return this.consolidator.consolidateAll();
  }

  async consolidateSession(sessionId: string): Promise<ConsolidationResult> {
    return this.consolidator.consolidateSession(sessionId);
  }

  // Context graph — entities, edges, and LLM-wiki summaries.

  upsertEntity(input: Omit<ContextGraphEntity, "id" | "createdAt" | "updatedAt"> & { id?: string }): ContextGraphEntity {
    return this.graph.upsertEntity(input);
  }

  getEntity(id: string): ContextGraphEntity | undefined {
    return this.graph.getEntity(id);
  }

  removeEntity(id: string): boolean {
    return this.graph.removeEntity(id);
  }

  listEntities(): ContextGraphEntity[] {
    return this.graph.listEntities();
  }

  findEntitiesByType(type: EntityType): ContextGraphEntity[] {
    return this.graph.findByType(type);
  }

  findEntitiesByName(name: string): ContextGraphEntity[] {
    return this.graph.findByName(name);
  }

  addEdge(fromId: string, toId: string, relation: string, weight?: number, metadata?: Record<string, unknown>): ContextGraphEdge {
    return this.graph.addEdge(fromId, toId, relation, weight, metadata);
  }

  removeEdge(edgeId: string): boolean {
    return this.graph.removeEdge(edgeId);
  }

  getEdges(entityId?: string): ContextGraphEdge[] {
    return this.graph.getEdges(entityId);
  }

  getNeighbors(entityId: string): NeighborResult[] {
    return this.graph.neighbors(entityId);
  }

  async buildEntityWiki(entityId: string): Promise<ContextGraphEntity> {
    return this.graph.buildWiki(entityId);
  }

  async buildAllWikis(): Promise<number> {
    return this.graph.buildAllWikis();
  }
}

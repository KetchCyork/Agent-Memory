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
export { type RetrievalHit };
import { Indexer, type IndexResult } from "../memory/indexer.js";
import { WorkMemoryStore, type WorkMemoryEntry, type WorkMemoryQuery } from "../memory/work-memory.js";
import { Consolidator, type ConsolidationResult } from "../memory/consolidator.js";
import { ContextGraph, type ContextGraphEntity, type ContextGraphEdge, type EntityType, type NeighborResult } from "../memory/context-graph.js";
import { RetrievalPolicyStore, applyRecencyBoost, type RetrievalPolicy } from "../memory/retrieval-policy.js";
import { FeedbackStore, applyFeedbackScoring, type FeedbackSignal, type NoteFeedback } from "../memory/feedback.js";
import { SnapshotStore, type SnapshotManifest } from "../memory/snapshots.js";
import { metrics, type MetricsSnapshot } from "./metrics.js";

export { type WorkMemoryEntry, type WorkMemoryQuery, type ConsolidationResult, type ContextGraphEntity, type ContextGraphEdge, type EntityType, type NeighborResult, type RetrievalPolicy, type FeedbackSignal, type NoteFeedback, type SnapshotManifest, type MetricsSnapshot };

export interface WikiSummary {
  entityId: string;
  name: string;
  type: EntityType;
  wiki: string;
}

export interface PolicySearchResult {
  hits: RetrievalHit[];
  wikis: WikiSummary[];
  policy: RetrievalPolicy;
}

export class MemoryEngine {
  private embedder: Embedder;
  private store: MemoryStore;
  private workMemory: WorkMemoryStore;
  private consolidator: Consolidator;
  private graph: ContextGraph;
  private policies: RetrievalPolicyStore;
  private feedback: FeedbackStore;
  private snapshots: SnapshotStore;
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
    this.policies = new RetrievalPolicyStore(cfg.policiesPath);
    this.feedback = new FeedbackStore(cfg.feedbackPath);
    this.snapshots = new SnapshotStore(cfg.snapshotsDir);
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
    const start = Date.now();
    try {
      await this.ensureOpen();
      const qvec = await this.embedder.embed(query);
      const hits = await this.store.retrieve(query, qvec, k, filter);
      metrics.recordSearch(Date.now() - start);
      return hits;
    } catch (err) {
      metrics.recordSearch(Date.now() - start, true);
      throw err;
    }
  }

  /** Rebuild the index from the vault. */
  async reindex(onProgress?: (m: string) => void): Promise<IndexResult> {
    const start = Date.now();
    try {
      const indexer = new Indexer(this.cfg.vaultPath, this.store, this.embedder);
      const res = await indexer.indexAll(onProgress);
      this.opened = true;
      metrics.recordIndex(Date.now() - start);
      return res;
    } catch (err) {
      metrics.recordIndex(Date.now() - start, true);
      throw err;
    }
  }

  // Work memory — episodic record of agent actions, outputs, and corrections.

  recordWork(entry: Omit<WorkMemoryEntry, "id" | "timestamp">): WorkMemoryEntry {
    const result = this.workMemory.record(entry);
    metrics.recordWorkMemory();
    return result;
  }

  queryWork(q: WorkMemoryQuery = {}): WorkMemoryEntry[] {
    return this.workMemory.query(q);
  }

  getWorkSession(sessionId: string): WorkMemoryEntry[] {
    return this.workMemory.getSession(sessionId);
  }

  recordCorrection(sessionId: string, note: string, sourceEntryId?: string): WorkMemoryEntry {
    const result = this.workMemory.recordCorrection(sessionId, note, sourceEntryId);
    metrics.recordWorkMemory();
    return result;
  }

  // Consolidation — synthesise sessions into vault lesson notes.

  async consolidateAll(): Promise<ConsolidationResult[]> {
    const results = await this.consolidator.consolidateAll();
    results.forEach(() => metrics.recordConsolidation());
    return results;
  }

  async consolidateSession(sessionId: string): Promise<ConsolidationResult> {
    const result = await this.consolidator.consolidateSession(sessionId);
    metrics.recordConsolidation();
    return result;
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

  // Retrieval policies

  getPolicy(name: string): RetrievalPolicy | undefined {
    return this.policies.get(name);
  }

  listPolicies(): RetrievalPolicy[] {
    return this.policies.list();
  }

  upsertPolicy(policy: RetrievalPolicy): RetrievalPolicy {
    return this.policies.upsert(policy);
  }

  deletePolicy(name: string): boolean {
    return this.policies.delete(name);
  }

  /** Search using a named policy (or "default"). Applies recency boost + wiki preload. */
  async searchWithPolicy(
    query: string,
    policyName = "default",
    overrides?: Partial<Pick<RetrievalPolicy, "k" | "filter">>
  ): Promise<PolicySearchResult> {
    const base = this.policies.get(policyName) ?? this.policies.get("default")!;
    const policy: RetrievalPolicy = { ...base, ...overrides };
    await this.ensureOpen();
    const qvec = await this.embedder.embed(query);
    let hits = await this.store.retrieve(query, qvec, policy.k, policy.filter);
    if (policy.boostRecent) hits = applyRecencyBoost(hits, policy.boostRecentFactor);
    hits = applyFeedbackScoring(hits, this.feedback);
    const wikis = policy.includeWiki ? this.collectWikis(query, policy.wikiEntityTypes) : [];
    return { hits, wikis, policy };
  }

  /** Preload wiki summaries for entities matching query or explicit IDs. */
  preloadWiki(options: {
    query?: string;
    entityIds?: string[];
    limit?: number;
  }): WikiSummary[] {
    const limit = options.limit ?? 10;
    let entities: ContextGraphEntity[] = [];
    if (options.entityIds?.length) {
      entities = options.entityIds
        .map((id) => this.graph.getEntity(id))
        .filter(Boolean) as ContextGraphEntity[];
    } else if (options.query) {
      entities = this.graph.findByName(options.query);
    } else {
      entities = this.graph.listEntities();
    }
    return entities
      .filter((e) => e.wiki)
      .slice(0, limit)
      .map((e) => ({ entityId: e.id, name: e.name, type: e.type, wiki: e.wiki! }));
  }

  // Feedback loop

  submitFeedback(
    notePath: string,
    vote: "up" | "down",
    opts: { sessionId?: string; query?: string; note?: string; workMemoryEntryId?: string } = {}
  ): FeedbackSignal {
    const signal = vote === "up"
      ? this.feedback.upvote(notePath, opts)
      : this.feedback.downvote(notePath, opts);
    metrics.recordFeedback();
    return signal;
  }

  listFeedbackSignals(notePath?: string): FeedbackSignal[] {
    return this.feedback.listSignals(notePath);
  }

  getFeedbackSummary(): ReturnType<FeedbackStore["summary"]> {
    return this.feedback.summary();
  }

  /**
   * Scan unprocessed work memory correction entries and convert them into
   * downvote signals. A correction entry is processable if it carries
   * args.notePaths (string[]) pointing to the vault notes that were unhelpful.
   */
  processCorrections(): { processed: number; signals: FeedbackSignal[] } {
    const corrections = this.workMemory.query({ type: "correction" });
    const unprocessed = corrections.filter((e) => !this.feedback.isProcessed(e.id));
    const signals: FeedbackSignal[] = [];
    const processedIds: string[] = [];

    for (const entry of unprocessed) {
      const notePaths: string[] = (entry.args?.notePaths as string[]) ?? [];
      for (const notePath of notePaths) {
        const signal = this.feedback.downvote(notePath, {
          sessionId: entry.sessionId,
          note: entry.correctionNote ?? entry.summary,
          workMemoryEntryId: entry.id,
        });
        signals.push(signal);
      }
      processedIds.push(entry.id);
    }

    if (processedIds.length) this.feedback.markProcessed(processedIds);
    return { processed: processedIds.length, signals };
  }

  // Metrics

  getMetrics(): MetricsSnapshot {
    return metrics.snapshot();
  }

  resetMetrics(): void {
    metrics.reset();
  }

  // Snapshots

  async createSnapshot(label?: string): Promise<SnapshotManifest> {
    return this.snapshots.create({
      workMemoryPath: this.cfg.workMemoryPath,
      graphPath: this.cfg.graphPath,
      feedbackPath: this.cfg.feedbackPath,
      label,
    });
  }

  listSnapshots(): SnapshotManifest[] {
    return this.snapshots.list();
  }

  getSnapshot(id: string): SnapshotManifest | undefined {
    return this.snapshots.get(id);
  }

  async restoreSnapshot(id: string): Promise<void> {
    return this.snapshots.restore(id);
  }

  deleteSnapshot(id: string): boolean {
    return this.snapshots.delete(id);
  }

  private collectWikis(query: string, types?: EntityType[]): WikiSummary[] {
    const matches = this.graph.findByName(query);
    const candidates = types ? matches.filter((e) => types.includes(e.type)) : matches;
    return candidates
      .filter((e) => e.wiki)
      .map((e) => ({ entityId: e.id, name: e.name, type: e.type, wiki: e.wiki! }));
  }
}

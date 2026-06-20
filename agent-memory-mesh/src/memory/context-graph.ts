/**
 * Context Graph
 * -------------
 * Structured knowledge layer: a graph of entities (projects, people, documents,
 * connectors, concepts) connected by typed edges. Each entity carries an optional
 * "wiki" — a compact 1-3 sentence LLM or rule-based summary auto-loadable into
 * agent context. This is the Context Graph / LLM-Wiki from the Perplexity Brain model.
 *
 * Storage: JSON file (human-readable, no graph database required).
 * Idempotent upsert — call upsertEntity repeatedly, only updatedAt changes.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type EntityType = "project" | "person" | "document" | "connector" | "concept";

export interface ContextGraphEntity {
  id: string;
  type: EntityType;
  name: string;
  description?: string;
  /** LLM-wiki: compact summary for context injection. Built on demand. */
  wiki?: string;
  wikiUpdatedAt?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ContextGraphEdge {
  id: string;
  fromId: string;
  toId: string;
  /** Free-form relation type, e.g. "works_on", "owns", "belongs_to", "references". */
  relation: string;
  weight?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface NeighborResult {
  entity: ContextGraphEntity;
  relation: string;
  direction: "outbound" | "inbound";
  edgeId: string;
  weight?: number;
}

interface GraphData {
  entities: Record<string, ContextGraphEntity>;
  edges: Record<string, ContextGraphEdge>;
}

export interface ContextGraphConfig {
  ollamaUrl?: string;
  wikiModel?: string;
}

export class ContextGraph {
  private data: GraphData = { entities: {}, edges: {} };

  constructor(
    private filePath: string,
    private cfg: ContextGraphConfig = {}
  ) {
    this.load();
  }

  // ---------------------------------------------------------------------------
  // Entities

  upsertEntity(
    input: Omit<ContextGraphEntity, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): ContextGraphEntity {
    const existing = input.id ? this.data.entities[input.id] : this.findByName(input.name)[0];
    const now = new Date().toISOString();

    if (existing) {
      const updated: ContextGraphEntity = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      this.data.entities[existing.id] = updated;
      this.save();
      return updated;
    }

    const entity: ContextGraphEntity = {
      ...input,
      id: input.id ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.data.entities[entity.id] = entity;
    this.save();
    return entity;
  }

  getEntity(id: string): ContextGraphEntity | undefined {
    return this.data.entities[id];
  }

  removeEntity(id: string): boolean {
    if (!this.data.entities[id]) return false;
    delete this.data.entities[id];
    // Cascade: remove all edges connected to this entity
    for (const [edgeId, edge] of Object.entries(this.data.edges)) {
      if (edge.fromId === id || edge.toId === id) delete this.data.edges[edgeId];
    }
    this.save();
    return true;
  }

  listEntities(): ContextGraphEntity[] {
    return Object.values(this.data.entities);
  }

  findByType(type: EntityType): ContextGraphEntity[] {
    return Object.values(this.data.entities).filter((e) => e.type === type);
  }

  findByName(name: string): ContextGraphEntity[] {
    const lower = name.toLowerCase();
    return Object.values(this.data.entities).filter((e) =>
      e.name.toLowerCase().includes(lower)
    );
  }

  // ---------------------------------------------------------------------------
  // Edges

  addEdge(
    fromId: string,
    toId: string,
    relation: string,
    weight?: number,
    metadata?: Record<string, unknown>
  ): ContextGraphEdge {
    const edge: ContextGraphEdge = {
      id: randomUUID(),
      fromId,
      toId,
      relation,
      weight,
      metadata,
      createdAt: new Date().toISOString(),
    };
    this.data.edges[edge.id] = edge;
    this.save();
    return edge;
  }

  removeEdge(edgeId: string): boolean {
    if (!this.data.edges[edgeId]) return false;
    delete this.data.edges[edgeId];
    this.save();
    return true;
  }

  getEdges(entityId?: string): ContextGraphEdge[] {
    const all = Object.values(this.data.edges);
    if (!entityId) return all;
    return all.filter((e) => e.fromId === entityId || e.toId === entityId);
  }

  // ---------------------------------------------------------------------------
  // Traversal

  neighbors(entityId: string): NeighborResult[] {
    const results: NeighborResult[] = [];
    for (const edge of Object.values(this.data.edges)) {
      if (edge.fromId === entityId) {
        const entity = this.data.entities[edge.toId];
        if (entity) results.push({ entity, relation: edge.relation, direction: "outbound", edgeId: edge.id, weight: edge.weight });
      } else if (edge.toId === entityId) {
        const entity = this.data.entities[edge.fromId];
        if (entity) results.push({ entity, relation: edge.relation, direction: "inbound", edgeId: edge.id, weight: edge.weight });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // LLM Wiki

  updateWiki(entityId: string, wiki: string): ContextGraphEntity {
    const entity = this.data.entities[entityId];
    if (!entity) throw new Error(`Entity not found: ${entityId}`);
    const updated = { ...entity, wiki, wikiUpdatedAt: new Date().toISOString() };
    this.data.entities[entityId] = updated;
    this.save();
    return updated;
  }

  async buildWiki(entityId: string): Promise<ContextGraphEntity> {
    const entity = this.data.entities[entityId];
    if (!entity) throw new Error(`Entity not found: ${entityId}`);

    const neighborList = this.neighbors(entityId);
    const wiki = this.cfg.wikiModel
      ? await this.llmWiki(entity, neighborList).catch(() => this.ruleWiki(entity, neighborList))
      : this.ruleWiki(entity, neighborList);

    return this.updateWiki(entityId, wiki);
  }

  /** Build all wikis (rule-based or LLM). Useful for batch refresh. */
  async buildAllWikis(): Promise<number> {
    let count = 0;
    for (const id of Object.keys(this.data.entities)) {
      await this.buildWiki(id);
      count++;
    }
    return count;
  }

  private ruleWiki(entity: ContextGraphEntity, neighbors: NeighborResult[]): string {
    const parts: string[] = [`${entity.name} is a ${entity.type}.`];
    if (entity.description) parts.push(entity.description);
    if (neighbors.length) {
      const neighborNames = neighbors.map((n) => `${n.entity.name} (${n.relation})`).join(", ");
      parts.push(`Connected to: ${neighborNames}.`);
    }
    if (entity.tags?.length) parts.push(`Tags: ${entity.tags.join(", ")}.`);
    return parts.join(" ");
  }

  private async llmWiki(entity: ContextGraphEntity, neighbors: NeighborResult[]): Promise<string> {
    const neighborDesc = neighbors.length
      ? neighbors.map((n) => `${n.entity.name} (${n.relation}, ${n.direction})`).join(", ")
      : "none";

    const prompt =
      `Write a 1-3 sentence wiki entry for the following entity. Be concise and factual.\n\n` +
      `Name: ${entity.name}\n` +
      `Type: ${entity.type}\n` +
      `Description: ${entity.description ?? "none"}\n` +
      `Tags: ${entity.tags?.join(", ") ?? "none"}\n` +
      `Connections: ${neighborDesc}\n\n` +
      `Wiki entry:`;

    const response = await fetch(`${this.cfg.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.cfg.wikiModel, prompt, stream: false }),
    });
    if (!response.ok) throw new Error(`Ollama generate failed: ${response.status}`);
    const data = (await response.json()) as { response: string };
    return data.response.trim();
  }

  // ---------------------------------------------------------------------------
  // Persistence

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      this.data = JSON.parse(raw);
      this.data.entities ??= {};
      this.data.edges ??= {};
    } catch {
      this.data = { entities: {}, edges: {} };
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}

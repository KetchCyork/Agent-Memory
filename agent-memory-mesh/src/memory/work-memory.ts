/**
 * Work Memory Store
 * -----------------
 * Episodic record of agent actions, outputs, corrections, and search signals —
 * the "what did we try and what happened" layer. Separate from the vault
 * retrieval layer. JSON-file backed: human-readable and no LanceDB required.
 * Powers overnight consolidation and feedback loops (Perplexity Brain model).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type WorkMemoryType = "action" | "output" | "correction" | "signal" | "search";

export interface WorkMemoryEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  type: WorkMemoryType;
  summary: string;
  command?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  success?: boolean;
  correctionNote?: string;
  sourceRef?: string;
  taskId?: string;
  agentId?: string;
  tags?: string[];
}

export interface WorkMemoryQuery {
  sessionId?: string;
  type?: WorkMemoryType;
  agentId?: string;
  since?: string;
  limit?: number;
}

export class WorkMemoryStore {
  private entries: WorkMemoryEntry[] = [];

  constructor(private filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      this.entries = JSON.parse(raw);
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), "utf8");
  }

  record(entry: Omit<WorkMemoryEntry, "id" | "timestamp">): WorkMemoryEntry {
    const full: WorkMemoryEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.entries.push(full);
    this.save();
    return full;
  }

  query(q: WorkMemoryQuery = {}): WorkMemoryEntry[] {
    let results = this.entries;
    if (q.sessionId) results = results.filter((e) => e.sessionId === q.sessionId);
    if (q.type) results = results.filter((e) => e.type === q.type);
    if (q.agentId) results = results.filter((e) => e.agentId === q.agentId);
    if (q.since) {
      const since = new Date(q.since).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= since);
    }
    if (q.limit && q.limit > 0) results = results.slice(-q.limit);
    return results;
  }

  getSession(sessionId: string): WorkMemoryEntry[] {
    return this.entries.filter((e) => e.sessionId === sessionId);
  }

  recordCorrection(
    sessionId: string,
    correctionNote: string,
    sourceEntryId?: string
  ): WorkMemoryEntry {
    return this.record({
      sessionId,
      type: "correction",
      summary: correctionNote,
      correctionNote,
      ...(sourceEntryId ? { sourceRef: sourceEntryId } : {}),
    });
  }
}

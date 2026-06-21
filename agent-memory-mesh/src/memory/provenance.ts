import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type ProvenanceSource = "vault" | "indexer" | "work-memory" | "remote" | "manual";

export interface ProvenanceRecord {
  id: string;
  notePath: string;
  source: ProvenanceSource;
  sourceUrl?: string;
  sourceSystem?: string;
  ingestedAt: string;
  ingestedBy?: string;
  sessionId?: string;
  confidence?: number;
  remoteNodeId?: string;
  remoteConnector?: string;
  metadata?: Record<string, unknown>;
}

export interface ProvenanceFilter {
  source?: ProvenanceSource;
  since?: string;
  remoteNodeId?: string;
  notePath?: string;
}

export class ProvenanceStore {
  private records: ProvenanceRecord[] = [];

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      this.records = JSON.parse(readFileSync(filePath, "utf8"));
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2));
  }

  record(entry: Omit<ProvenanceRecord, "id" | "ingestedAt">): ProvenanceRecord {
    const rec: ProvenanceRecord = {
      ...entry,
      id: randomUUID(),
      ingestedAt: new Date().toISOString(),
    };
    this.records.push(rec);
    this.save();
    return rec;
  }

  getByNotePath(notePath: string): ProvenanceRecord[] {
    return this.records.filter((r) => r.notePath === notePath);
  }

  list(filter?: ProvenanceFilter): ProvenanceRecord[] {
    let results = this.records;
    if (filter?.source) results = results.filter((r) => r.source === filter.source);
    if (filter?.since) results = results.filter((r) => r.ingestedAt >= filter.since!);
    if (filter?.remoteNodeId) results = results.filter((r) => r.remoteNodeId === filter.remoteNodeId);
    if (filter?.notePath) results = results.filter((r) => r.notePath === filter.notePath);
    return results;
  }

  delete(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  listByRemoteNode(remoteNodeId: string): ProvenanceRecord[] {
    return this.records.filter((r) => r.remoteNodeId === remoteNodeId);
  }

  summaryByNode(): { remoteNodeId: string; count: number; lastSync: string }[] {
    const byNode = new Map<string, { count: number; lastSync: string }>();
    for (const r of this.records) {
      if (!r.remoteNodeId) continue;
      const existing = byNode.get(r.remoteNodeId);
      if (!existing) {
        byNode.set(r.remoteNodeId, { count: 1, lastSync: r.ingestedAt });
      } else {
        existing.count++;
        if (r.ingestedAt > existing.lastSync) existing.lastSync = r.ingestedAt;
      }
    }
    return [...byNode.entries()].map(([remoteNodeId, v]) => ({ remoteNodeId, ...v }));
  }
}

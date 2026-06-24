import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { RetrievalHit } from "./store.js";

export interface ChunkScore {
  notePath: string;
  score: number;
  accessCount: number;
  lastAccessedAt: string;
  createdAt: string;
}

export interface ScoringConfig {
  decayEnabled: boolean;
  decayHalfLifeDays: number;
  minScore: number;
}

export class ScoringStore {
  private scores: Map<string, ChunkScore> = new Map();

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, "utf8")) as ChunkScore[];
      for (const s of data) this.scores.set(s.notePath, s);
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify([...this.scores.values()], null, 2));
  }

  recordAccess(notePath: string): ChunkScore {
    const now = new Date().toISOString();
    const existing = this.scores.get(notePath);
    const entry: ChunkScore = {
      notePath,
      score: 1.0,
      accessCount: (existing?.accessCount ?? 0) + 1,
      lastAccessedAt: now,
      createdAt: existing?.createdAt ?? now,
    };
    this.scores.set(notePath, entry);
    this.save();
    return entry;
  }

  getDecayedScore(notePath: string, cfg: ScoringConfig): number {
    if (!cfg.decayEnabled) return 1.0;
    const entry = this.scores.get(notePath);
    if (!entry) return 1.0;
    const daysSince = (Date.now() - new Date(entry.lastAccessedAt).getTime()) / 86400000;
    const decayed = Math.pow(0.5, daysSince / cfg.decayHalfLifeDays);
    return Math.max(cfg.minScore, Math.min(1.0, decayed));
  }

  listScores(): ChunkScore[] {
    return [...this.scores.values()];
  }

  applyDecayScores(hits: RetrievalHit[], cfg: ScoringConfig): RetrievalHit[] {
    if (!cfg.decayEnabled) return hits;
    const adjusted = hits.map((h) => ({
      ...h,
      score: h.score * this.getDecayedScore(h.chunk.notePath, cfg),
    }));
    adjusted.sort((a, b) => b.score - a.score);
    return adjusted;
  }
}

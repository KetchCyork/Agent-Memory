/**
 * Feedback Store
 * --------------
 * Tracks upvote / downvote signals per vault note path. Each signal adjusts a
 * per-note relevance multiplier applied during retrieval re-ranking. This is the
 * feedback loop from the Perplexity Brain model: user corrections flow back into
 * retrieval quality over time.
 *
 * Score formula: 1.0 + (upvotes - downvotes) * STEP, clamped to [MIN, MAX].
 * Storage: JSON file, one record per notePath.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { RetrievalHit } from "./store.js";

const SCORE_STEP = 0.1;
const SCORE_MIN = 0.1;
const SCORE_MAX = 2.0;

export interface FeedbackSignal {
  id: string;
  notePath: string;
  vote: "up" | "down";
  sessionId?: string;
  query?: string;
  note?: string;
  timestamp: string;
  workMemoryEntryId?: string;
}

export interface NoteFeedback {
  notePath: string;
  score: number;
  upvotes: number;
  downvotes: number;
  signals: FeedbackSignal[];
}

interface FeedbackData {
  notes: Record<string, NoteFeedback>;
  processedCorrectionIds: string[];
}

export class FeedbackStore {
  private data: FeedbackData = { notes: {}, processedCorrectionIds: [] };

  constructor(private filePath: string) {
    this.load();
  }

  upvote(
    notePath: string,
    opts: { sessionId?: string; query?: string; note?: string; workMemoryEntryId?: string } = {}
  ): FeedbackSignal {
    return this.addSignal(notePath, "up", opts);
  }

  downvote(
    notePath: string,
    opts: { sessionId?: string; query?: string; note?: string; workMemoryEntryId?: string } = {}
  ): FeedbackSignal {
    return this.addSignal(notePath, "down", opts);
  }

  getScore(notePath: string): number {
    return this.data.notes[notePath]?.score ?? 1.0;
  }

  getNote(notePath: string): NoteFeedback | undefined {
    return this.data.notes[notePath];
  }

  listSignals(notePath?: string): FeedbackSignal[] {
    if (notePath) return this.data.notes[notePath]?.signals ?? [];
    return Object.values(this.data.notes).flatMap((n) => n.signals);
  }

  summary(): { topUpvoted: NoteFeedback[]; topDownvoted: NoteFeedback[]; totalSignals: number } {
    const all = Object.values(this.data.notes);
    const topUpvoted = [...all].sort((a, b) => b.upvotes - a.upvotes).slice(0, 10);
    const topDownvoted = [...all].sort((a, b) => b.downvotes - a.downvotes).slice(0, 10);
    const totalSignals = all.reduce((s, n) => s + n.signals.length, 0);
    return { topUpvoted, topDownvoted, totalSignals };
  }

  isProcessed(correctionId: string): boolean {
    return this.data.processedCorrectionIds.includes(correctionId);
  }

  markProcessed(correctionIds: string[]): void {
    const set = new Set(this.data.processedCorrectionIds);
    for (const id of correctionIds) set.add(id);
    this.data.processedCorrectionIds = [...set];
    this.save();
  }

  // ---------------------------------------------------------------------------

  private addSignal(
    notePath: string,
    vote: "up" | "down",
    opts: { sessionId?: string; query?: string; note?: string; workMemoryEntryId?: string }
  ): FeedbackSignal {
    const signal: FeedbackSignal = {
      id: randomUUID(),
      notePath,
      vote,
      timestamp: new Date().toISOString(),
      ...opts,
    };

    if (!this.data.notes[notePath]) {
      this.data.notes[notePath] = { notePath, score: 1.0, upvotes: 0, downvotes: 0, signals: [] };
    }

    const record = this.data.notes[notePath];
    record.signals.push(signal);
    if (vote === "up") record.upvotes++;
    else record.downvotes++;
    record.score = Math.min(
      SCORE_MAX,
      Math.max(SCORE_MIN, 1.0 + (record.upvotes - record.downvotes) * SCORE_STEP)
    );

    this.save();
    return signal;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.data.notes = parsed.notes ?? {};
      this.data.processedCorrectionIds = parsed.processedCorrectionIds ?? [];
    } catch {
      this.data = { notes: {}, processedCorrectionIds: [] };
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}

// ---------------------------------------------------------------------------
// Retrieval integration

/**
 * Multiply each hit's score by its notePath's feedback score, then re-sort.
 * Notes with net upvotes surface higher; net downvotes surface lower.
 */
export function applyFeedbackScoring(
  hits: RetrievalHit[],
  store: FeedbackStore
): RetrievalHit[] {
  const any = hits.some((h) => store.getScore(h.chunk.notePath) !== 1.0);
  if (!any) return hits;
  return hits
    .map((hit) => ({
      ...hit,
      score: hit.score * store.getScore(hit.chunk.notePath),
    }))
    .sort((a, b) => b.score - a.score);
}

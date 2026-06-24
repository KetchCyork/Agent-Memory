export interface MetricsSnapshot {
  searchCount: number;
  searchErrors: number;
  totalSearchLatencyMs: number;
  avgSearchLatencyMs: number;
  indexCount: number;
  indexErrors: number;
  totalIndexLatencyMs: number;
  workMemoryCount: number;
  consolidationCount: number;
  feedbackCount: number;
  uptimeMs: number;
  startedAt: string;
}

export class MetricsCollector {
  private startedAt = new Date();
  private searchCount = 0;
  private searchErrors = 0;
  private totalSearchLatencyMs = 0;
  private indexCount = 0;
  private indexErrors = 0;
  private totalIndexLatencyMs = 0;
  private workMemoryCount = 0;
  private consolidationCount = 0;
  private feedbackCount = 0;

  recordSearch(latencyMs: number, error = false): void {
    this.searchCount++;
    this.totalSearchLatencyMs += latencyMs;
    if (error) this.searchErrors++;
  }

  recordIndex(latencyMs: number, error = false): void {
    this.indexCount++;
    this.totalIndexLatencyMs += latencyMs;
    if (error) this.indexErrors++;
  }

  recordWorkMemory(): void {
    this.workMemoryCount++;
  }

  recordConsolidation(): void {
    this.consolidationCount++;
  }

  recordFeedback(): void {
    this.feedbackCount++;
  }

  snapshot(): MetricsSnapshot {
    return {
      searchCount: this.searchCount,
      searchErrors: this.searchErrors,
      totalSearchLatencyMs: this.totalSearchLatencyMs,
      avgSearchLatencyMs: this.searchCount > 0 ? this.totalSearchLatencyMs / this.searchCount : 0,
      indexCount: this.indexCount,
      indexErrors: this.indexErrors,
      totalIndexLatencyMs: this.totalIndexLatencyMs,
      workMemoryCount: this.workMemoryCount,
      consolidationCount: this.consolidationCount,
      feedbackCount: this.feedbackCount,
      uptimeMs: Date.now() - this.startedAt.getTime(),
      startedAt: this.startedAt.toISOString(),
    };
  }

  reset(): void {
    this.startedAt = new Date();
    this.searchCount = 0;
    this.searchErrors = 0;
    this.totalSearchLatencyMs = 0;
    this.indexCount = 0;
    this.indexErrors = 0;
    this.totalIndexLatencyMs = 0;
    this.workMemoryCount = 0;
    this.consolidationCount = 0;
    this.feedbackCount = 0;
  }
}

/** Process-level singleton — one collector for the entire service lifetime. */
export const metrics = new MetricsCollector();

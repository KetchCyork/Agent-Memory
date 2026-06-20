/**
 * Consolidator
 * ------------
 * Reads episodic work memory sessions and synthesises them into concise lesson
 * notes written to the vault. This is the "overnight consolidation" step from
 * the Perplexity Brain model: short-term episodic records → lasting knowledge.
 *
 * Two synthesis paths:
 *   1. LLM (Ollama generate) — if CONSOLIDATION_MODEL is set
 *   2. Rule-based — always available, no external service required
 *
 * Output format: vault/10-inbox/lesson-<sessionId>.md with YAML frontmatter.
 * Re-running is idempotent — same sessionId overwrites the same file.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkMemoryEntry } from "./work-memory.js";
import type { WorkMemoryStore } from "./work-memory.js";

export interface ConsolidationResult {
  sessionId: string;
  lessonPath: string;
  entryCount: number;
  successCount: number;
  failureCount: number;
  correctionCount: number;
  method: "llm" | "rule-based";
}

export interface ConsolidatorConfig {
  vaultPath: string;
  ollamaUrl?: string;
  consolidationModel?: string;
}

export class Consolidator {
  constructor(
    private store: WorkMemoryStore,
    private cfg: ConsolidatorConfig
  ) {}

  async consolidateAll(): Promise<ConsolidationResult[]> {
    const sessions = this.groupBySessions();
    const results: ConsolidationResult[] = [];
    for (const [sessionId, entries] of sessions) {
      results.push(await this.consolidateSession(sessionId, entries));
    }
    return results;
  }

  async consolidateSession(sessionId: string, entries?: WorkMemoryEntry[]): Promise<ConsolidationResult> {
    const sessionEntries = entries ?? this.store.getSession(sessionId);
    const stats = this.computeStats(sessionEntries);
    const method = this.cfg.consolidationModel ? "llm" : "rule-based";

    let summary: string;
    if (method === "llm") {
      summary = await this.llmSynthesize(sessionId, sessionEntries).catch(() => {
        // Fall back gracefully if Ollama is unreachable
        return this.ruleSynthesize(sessionId, sessionEntries, stats);
      });
    } else {
      summary = this.ruleSynthesize(sessionId, sessionEntries, stats);
    }

    const lessonPath = this.writeLessonNote(sessionId, summary, stats, method);
    return { sessionId, lessonPath, method, ...stats };
  }

  // ---------------------------------------------------------------------------

  private groupBySessions(): Map<string, WorkMemoryEntry[]> {
    const all = this.store.query();
    const map = new Map<string, WorkMemoryEntry[]>();
    for (const entry of all) {
      if (!map.has(entry.sessionId)) map.set(entry.sessionId, []);
      map.get(entry.sessionId)!.push(entry);
    }
    return map;
  }

  private computeStats(entries: WorkMemoryEntry[]): Pick<ConsolidationResult, "entryCount" | "successCount" | "failureCount" | "correctionCount"> {
    let successCount = 0;
    let failureCount = 0;
    let correctionCount = 0;
    for (const e of entries) {
      if (e.type === "correction") correctionCount++;
      else if (e.success === true) successCount++;
      else if (e.success === false) failureCount++;
    }
    return { entryCount: entries.length, successCount, failureCount, correctionCount };
  }

  private ruleSynthesize(
    sessionId: string,
    entries: WorkMemoryEntry[],
    stats: ReturnType<typeof this.computeStats>
  ): string {
    const successes = entries.filter((e) => e.success === true && e.type !== "correction");
    const failures = entries.filter((e) => e.success === false);
    const corrections = entries.filter((e) => e.type === "correction");
    const signals = entries.filter((e) => e.type === "signal");

    const lines: string[] = [];
    lines.push(`## Summary\n`);
    lines.push(
      `Session \`${sessionId}\` ran ${stats.entryCount} entries: ` +
        `${stats.successCount} succeeded, ${stats.failureCount} failed, ` +
        `${stats.correctionCount} correction(s) recorded.\n`
    );

    if (successes.length) {
      lines.push(`## What worked\n`);
      for (const e of successes) {
        const cmd = e.command ? ` (\`${e.command}\`)` : "";
        lines.push(`- ${e.summary}${cmd}`);
      }
      lines.push("");
    }

    if (failures.length) {
      lines.push(`## What failed\n`);
      for (const e of failures) {
        const cmd = e.command ? ` (\`${e.command}\`)` : "";
        lines.push(`- ${e.summary}${cmd}`);
      }
      lines.push("");
    }

    if (corrections.length) {
      lines.push(`## Corrections / lessons\n`);
      for (const e of corrections) {
        lines.push(`- ${e.correctionNote ?? e.summary}`);
        if (e.sourceRef) lines.push(`  *(corrects entry \`${e.sourceRef}\`)*`);
      }
      lines.push("");
    }

    if (signals.length) {
      lines.push(`## Signals\n`);
      for (const e of signals) lines.push(`- ${e.summary}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  private async llmSynthesize(sessionId: string, entries: WorkMemoryEntry[]): Promise<string> {
    const entrySummary = entries
      .map((e) => `[${e.type}${e.success !== undefined ? ` success=${e.success}` : ""}] ${e.summary}${e.correctionNote ? ` | correction: ${e.correctionNote}` : ""}`)
      .join("\n");

    const prompt =
      `You are a memory consolidation assistant. A user's AI agent completed a work session.\n` +
      `Below are the episodic records from session "${sessionId}".\n\n` +
      `${entrySummary}\n\n` +
      `Write a concise lesson note for future reference. Include:\n` +
      `1. A 1-2 sentence summary of what the session accomplished.\n` +
      `2. What approaches worked well.\n` +
      `3. What failed and why (if applicable).\n` +
      `4. Key corrections or things to remember.\n\n` +
      `Format as Markdown. Be specific and actionable. Avoid generic advice.`;

    const response = await fetch(`${this.cfg.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.cfg.consolidationModel,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) throw new Error(`Ollama generate failed: ${response.status}`);
    const data = (await response.json()) as { response: string };
    return data.response;
  }

  private writeLessonNote(
    sessionId: string,
    summary: string,
    stats: ReturnType<typeof this.computeStats>,
    method: "llm" | "rule-based"
  ): string {
    const inboxDir = join(this.cfg.vaultPath, "10-inbox");
    if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });

    const slug = sessionId.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 60);
    const filename = `lesson-${slug}.md`;
    const filePath = join(inboxDir, filename);
    const now = new Date().toISOString();

    const frontmatter = [
      "---",
      "type: lesson",
      `sessionId: "${sessionId}"`,
      `consolidatedAt: "${now}"`,
      `synthesis: ${method}`,
      `entryCount: ${stats.entryCount}`,
      `successCount: ${stats.successCount}`,
      `failureCount: ${stats.failureCount}`,
      `correctionCount: ${stats.correctionCount}`,
      "tags: [lesson, consolidated]",
      "---",
      "",
      `# Session Lesson: ${sessionId}`,
      "",
    ].join("\n");

    writeFileSync(filePath, frontmatter + summary, "utf8");
    return filePath;
  }
}

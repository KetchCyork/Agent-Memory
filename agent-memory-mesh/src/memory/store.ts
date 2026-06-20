/**
 * Memory Store (LanceDB)
 * ----------------------
 * Stores text chunks + their embeddings + metadata in a local LanceDB table,
 * and retrieves with HYBRID search: semantic (vector) results fused with
 * keyword (term-overlap) results via Reciprocal Rank Fusion (RRF).
 *
 * Why hybrid: pure vector search misses exact terms (names, IDs, a specific
 * client or product). Keyword scoring catches those; RRF merges the two ranked
 * lists into one. For larger vaults, LanceDB also has a native full-text index
 * and built-in rerankers that can replace the keyword pass below — see
 * https://lancedb.github.io/lancedb/ . The keyword+RRF approach here keeps the
 * dependency surface small and is plenty for a personal/team-sized vault.
 */

import * as lancedb from "@lancedb/lancedb";

export interface Chunk {
  id: string;          // stable id: `${notePath}#${index}`
  text: string;
  vector: number[];
  // --- metadata for filtering / provenance ---
  notePath: string;    // source note, relative to the vault
  type: string;        // frontmatter type: project | knowledge | log | profile | ...
  tags: string;        // space-joined, so it survives columnar storage simply
  source: string;      // manual | onedrive | outlook | omi | ...
  updated: string;     // ISO timestamp
}

export interface RetrievalHit {
  chunk: Omit<Chunk, "vector">;
  score: number;       // fused RRF score (higher = better)
}

const TABLE = "memory";
const RRF_K = 60;      // standard RRF constant

export class MemoryStore {
  private db!: lancedb.Connection;
  private table!: lancedb.Table;

  constructor(private dbPath: string) {}

  /** Open (or create) the local database + table. */
  async open(sampleDim?: number): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    const names = await this.db.tableNames();
    if (names.includes(TABLE)) {
      this.table = await this.db.openTable(TABLE);
    } else {
      if (!sampleDim) throw new Error("First run needs sampleDim to create the table.");
      // Create with a single throwaway row to fix the schema, then delete it.
      const seed: Chunk = {
        id: "__seed__", text: "", vector: new Array(sampleDim).fill(0),
        notePath: "", type: "", tags: "", source: "", updated: "",
      };
      this.table = await this.db.createTable(TABLE, [seed] as unknown as Record<string, unknown>[]);
      await this.table.delete(`id = '__seed__'`);
    }
  }

  /** Upsert chunks for a note: delete any existing rows for it, then add. */
  async putNoteChunks(notePath: string, chunks: Chunk[]): Promise<void> {
    await this.table.delete(`notePath = ${quote(notePath)}`);
    if (chunks.length) await this.table.add(chunks as unknown as Record<string, unknown>[]);
  }

  /** Remove all chunks for a note (e.g. when it's deleted). */
  async removeNote(notePath: string): Promise<void> {
    await this.table.delete(`notePath = ${quote(notePath)}`);
  }

  /**
   * Hybrid retrieve: vector top-N + keyword top-N, fused with RRF.
   * `filter` is an optional SQL-ish predicate over metadata (e.g. type/tags).
   */
  async retrieve(
    queryText: string,
    queryVector: number[],
    k = 8,
    filter?: string
  ): Promise<RetrievalHit[]> {
    const pool = Math.max(k * 4, 24);

    // 1) Semantic ranking from LanceDB.
    let q = this.table.search(queryVector).limit(pool);
    if (filter) q = q.where(filter);
    const vecRows = (await q.toArray()) as any[];

    // 2) Keyword ranking: pull a candidate set and score by term overlap.
    const terms = tokenize(queryText);
    const candRows = (await this.table.query().limit(2000).toArray()) as any[];
    const kwScored = candRows
      .map((r) => ({ r, s: keywordScore(terms, String(r.text)) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, pool)
      .map((x) => x.r);

    // 3) Reciprocal Rank Fusion of the two ranked lists.
    const fused = new Map<string, { row: any; score: number }>();
    const fuse = (rows: any[]) => {
      rows.forEach((row, i) => {
        const id = String(row.id);
        const add = 1 / (RRF_K + i + 1);
        const cur = fused.get(id);
        if (cur) cur.score += add;
        else fused.set(id, { row, score: add });
      });
    };
    fuse(vecRows);
    fuse(kwScored);

    return [...fused.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ row, score }) => ({
        score,
        chunk: {
          id: String(row.id), text: String(row.text), notePath: String(row.notePath),
          type: String(row.type), tags: String(row.tags),
          source: String(row.source), updated: String(row.updated),
        },
      }));
  }
}

function quote(s: string): string { return `'${s.replace(/'/g, "''")}'`; }

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
}

/** Simple term-overlap score; good enough as the keyword arm of hybrid search. */
function keywordScore(queryTerms: string[], text: string): number {
  if (!queryTerms.length) return 0;
  const hay = new Set(tokenize(text));
  let hits = 0;
  for (const t of queryTerms) if (hay.has(t)) hits++;
  return hits;
}

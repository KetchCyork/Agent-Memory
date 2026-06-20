/**
 * Indexer
 * -------
 * Ingests the vault into the LanceDB memory store: read notes -> chunk ->
 * embed (locally via Ollama) -> upsert. Run it on demand or on a watch.
 */

import { Embedder } from "./embeddings.js";
import { MemoryStore, type Chunk } from "./store.js";
import { listMarkdown, parseNote } from "./vault.js";

export interface IndexResult {
  notes: number;
  chunks: number;
}

export class Indexer {
  constructor(
    private vaultPath: string,
    private store: MemoryStore,
    private embedder: Embedder
  ) {}

  /** Full (re)index of the vault. */
  async indexAll(onProgress?: (msg: string) => void): Promise<IndexResult> {
    const files = await listMarkdown(this.vaultPath);
    let totalChunks = 0;

    // Ensure the store/table exists; size it from a probe embedding.
    const probe = await this.embedder.embed("dimension probe");
    await this.store.open(probe.length);

    for (const file of files) {
      const note = await parseNote(file, this.vaultPath);
      if (!note.chunks.length) continue;
      const vectors = await this.embedder.embedMany(note.chunks.map((c) => c.text));
      const rows: Chunk[] = note.chunks.map((c, i) => ({
        id: `${note.notePath}#${c.index}`,
        text: c.text,
        vector: vectors[i],
        notePath: note.notePath,
        type: note.type,
        tags: note.tags,
        source: note.source,
        updated: note.updated,
      }));
      await this.store.putNoteChunks(note.notePath, rows);
      totalChunks += rows.length;
      onProgress?.(`indexed ${note.notePath} (${rows.length} chunks)`);
    }
    return { notes: files.length, chunks: totalChunks };
  }
}

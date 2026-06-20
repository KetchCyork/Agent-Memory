/**
 * Embeddings (local, via Ollama)
 * ------------------------------
 * Turns text into vectors using a local model (default: nomic-embed-text).
 * Runs entirely on the user's machine, so private/work content can be indexed
 * without sending it to any cloud provider.
 *
 * Pull the model once: `ollama pull nomic-embed-text`
 */

export interface EmbedderOptions {
  ollamaUrl?: string;   // default http://localhost:11434
  model?: string;       // default nomic-embed-text
}

export class Embedder {
  private url: string;
  readonly model: string;

  constructor(opts: EmbedderOptions = {}) {
    this.url = opts.ollamaUrl ?? "http://localhost:11434";
    this.model = opts.model ?? "nomic-embed-text";
  }

  /** Embed a single string. */
  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.url}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(
        `Ollama embeddings ${res.status}: ${await res.text()} ` +
        `(is Ollama running, and has "${this.model}" been pulled?)`
      );
    }
    const data: any = await res.json();
    if (!Array.isArray(data.embedding)) throw new Error("No embedding returned by Ollama.");
    return data.embedding as number[];
  }

  /** Embed many strings sequentially (keeps memory + local GPU pressure sane). */
  async embedMany(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}

export class LruCache<T> {
  private map: Map<string, { value: T; expiresAt: number }> = new Map();
  private _hits = 0;
  private _misses = 0;

  constructor(private maxSize: number, private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this._misses++;
      return undefined;
    }
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    this._hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) {
      // Evict least recently used (first entry in insertion order)
      const lruKey = this.map.keys().next().value;
      if (lruKey !== undefined) this.map.delete(lruKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  stats() {
    return {
      size: this.map.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      hits: this._hits,
      misses: this._misses,
    };
  }
}

export function cacheKey(query: string, k: number, filter?: string, policy?: string): string {
  return `${query}|${k}|${filter ?? ""}|${policy ?? ""}`;
}

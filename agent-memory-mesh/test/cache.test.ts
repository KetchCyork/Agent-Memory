import { LruCache, cacheKey } from "../src/memory/cache.js";

export async function runCacheTests() {
  // Basic get/set
  const cache = new LruCache<string>(3, 60000);
  cache.set("a", "alpha");
  console.assert(cache.get("a") === "alpha", "cache hit");
  console.assert(cache.get("z") === undefined, "cache miss for unknown key");

  // TTL expiry
  const shortCache = new LruCache<string>(10, 1);
  shortCache.set("x", "xval");
  await new Promise((r) => setTimeout(r, 10));
  console.assert(shortCache.get("x") === undefined, "expired entry returns undefined");

  // LRU eviction: size-3 cache, touch "1" so "2" becomes LRU, then "4" evicts "2"
  const lru = new LruCache<number>(3, 60000);
  lru.set("1", 1);
  lru.set("2", 2);
  lru.set("3", 3);
  lru.get("1"); // promote "1"
  lru.set("4", 4); // evicts "2" (LRU)
  console.assert(lru.get("2") === undefined, "LRU entry evicted");
  console.assert(lru.get("1") !== undefined, "touched entry still present");
  console.assert(lru.get("3") !== undefined, "non-LRU entry still present");
  console.assert(lru.get("4") !== undefined, "newly added entry present");

  // Stats
  const stats = lru.stats();
  console.assert(stats.maxSize === 3, "maxSize correct");
  console.assert(stats.hits > 0, "hits > 0");
  console.assert(stats.misses > 0, "misses > 0");

  // clear
  lru.clear();
  console.assert(lru.stats().size === 0, "cleared");

  // delete
  const d = new LruCache<string>(5, 60000);
  d.set("k", "v");
  d.delete("k");
  console.assert(d.get("k") === undefined, "deleted key gone");

  // cacheKey
  const k = cacheKey("hello world", 8, "type=doc", "default");
  console.assert(k.includes("hello world"), "cacheKey includes query");
  console.assert(cacheKey("q", 5) !== cacheKey("q", 8), "different k produces different key");

  console.log("[cache] All tests passed");
}

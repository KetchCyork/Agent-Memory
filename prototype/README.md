Agent Memory prototype

This prototype includes:

- `consolidator.js` — reads `data/sessions.json`, synthesizes simple summaries, writes `data/memories.json` with fake embeddings.
- `scorer.js` — computes a simple utility score per memory.
- `retriever.js` — retrieves memories by combining cosine similarity on fake embeddings, naive BM25, and utility score.

Run:

```powershell
cd "Agent Memory/prototype"
node consolidator.js
node retriever.js "project milestones"
```

This is a minimal, local prototype to demonstrate the consolidation -> storage -> retrieval loop. Replace the embedding function with a real embedder and the storage with a vector DB for production.

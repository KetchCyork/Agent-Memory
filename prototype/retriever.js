const fs = require('fs');
const path = require('path');
const { embed } = require('./consolidator');
const { score } = require('./scorer');

const MEMORIES = path.join(__dirname, 'data', 'memories.json');

function loadMemories() {
  return JSON.parse(fs.readFileSync(MEMORIES, 'utf8'));
}

function dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }

function cosineSim(a, b) {
  const d = dot(a, b);
  // vectors are normalized in consolidator
  return d;
}

function bm25Score(queryTokens, text) {
  // very naive token-overlap score
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  const qset = new Set(queryTokens.map(t => t.toLowerCase()));
  let count = 0;
  tokens.forEach(t => { if (qset.has(t)) count++; });
  return count / Math.sqrt(tokens.length || 1);
}

function retrieve(query, k = 5) {
  const qEmbedding = embed(query);
  const qTokens = query.split(/\W+/).filter(Boolean);
  const memories = loadMemories();

  const scored = memories.map(m => {
    const sim = cosineSim(qEmbedding, m.embedding || []);
    const bm25 = bm25Score(qTokens, m.text);
    const utility = score(m);
    // combine signals
    const combined = (sim * 0.6) + (bm25 * 0.3) + (utility * 0.1);
    return { memory: m, sim, bm25, utility, combined };
  });

  scored.sort((a,b) => b.combined - a.combined);
  return scored.slice(0, k);
}

if (require.main === module) {
  const q = process.argv.slice(2).join(' ') || 'project milestones';
  const results = retrieve(q, 5);
  console.log(`Top results for query: "${q}"\n`);
  results.forEach((r, i) => {
    console.log(`#${i+1} combined=${r.combined.toFixed(3)} sim=${r.sim.toFixed(3)} bm25=${r.bm25.toFixed(3)} util=${r.utility.toFixed(3)}`);
    console.log(`-> ${r.memory.text}`);
    console.log(`  source: ${r.memory.source} timestamp: ${r.memory.timestamp}`);
    console.log('');
  });
}

module.exports = { retrieve };

const fs = require('fs');
const path = require('path');

const SESSIONS = path.join(__dirname, 'data', 'sessions.json');
const MEMORIES = path.join(__dirname, 'data', 'memories.json');

function loadSessions() {
  return JSON.parse(fs.readFileSync(SESSIONS, 'utf8'));
}

function saveMemories(memories) {
  fs.writeFileSync(MEMORIES, JSON.stringify(memories, null, 2));
}

// naive summarizer: join agent messages and take first 240 chars
function summarizeSession(session) {
  const agentMsgs = session.messages.filter(m => m.role === 'agent').map(m => m.text).join(' ');
  const summary = (agentMsgs || session.title || '').slice(0, 240);
  return summary || session.title || '';
}

// fake deterministic embedding: map chars to small vector
function embed(text, dim = 32) {
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    vec[i % dim] += c % 97;
  }
  // normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

function nowIso() { return new Date().toISOString(); }

function run() {
  const sessions = loadSessions();
  const memories = [];

  sessions.forEach(s => {
    const summary = summarizeSession(s);
    const embedding = embed(summary);
    const memory = {
      id: `mem-${s.id}`,
      text: summary,
      source: s.id,
      timestamp: s.timestamp || nowIso(),
      metadata: s.metadata || {},
      embedding
    };
    memories.push(memory);
  });

  saveMemories(memories);
  console.log(`Wrote ${memories.length} memories to ${MEMORIES}`);
}

if (require.main === module) run();
module.exports = { run, summarizeSession, embed };

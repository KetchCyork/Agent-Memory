// Simple utility scorer: recency + corrections + length

function ageScore(timestamp) {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  // more recent -> higher score
  return Math.max(0, 1 - days / 30);
}

function correctionsScore(metadata) {
  return (metadata && metadata.corrections) ? (1 + metadata.corrections * 0.5) : 1;
}

function lengthScore(text) {
  return Math.min(1, text.length / 200);
}

function score(memory) {
  const s = 0.5 * ageScore(memory.timestamp) + 0.3 * lengthScore(memory.text) + 0.2 * correctionsScore(memory.metadata || {});
  return s;
}

module.exports = { score };

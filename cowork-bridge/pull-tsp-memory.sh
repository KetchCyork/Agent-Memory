#!/usr/bin/env bash
#
# pull-tsp-memory.sh - macOS/Linux equivalent of pull-tsp-memory.ps1
#
# Queries a memory brain and writes a markdown snapshot into a folder Claude
# Cowork can read. Cowork's custom connectors dial out from Anthropic's cloud,
# so they cannot reach a brain on localhost or a tailnet; local files are the
# seam that works.
#
# Config: ~/.cowork-memory/config.json
#   { "host": "127.0.0.1", "port": 8377, "apiKey": "..." }
# Environment MEMORY_HOST / MEMORY_PORT / MEMORY_API_KEY override the file.
#
# Usage:
#   ./pull-tsp-memory.sh [output-dir]
#   ./pull-tsp-memory.sh ~/CoworkMemory/tsp-proposals
#
# Fail-soft by design: if the brain is unreachable the previous snapshot is left
# in place and marked _STALE.md, so Cowork sees staleness rather than an empty
# folder. Exit 0 success, 1 total failure, 2 some topics failed.

set -uo pipefail

OUT_DIR="${1:-$HOME/CoworkMemory/tsp-proposals}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOPICS="${TOPICS_FILE:-$SCRIPT_DIR/topics.json}"
CONFIG="${CONFIG_FILE:-$HOME/.cowork-memory/config.json}"

log() { printf '[%s] %-5s %s\n' "$(date +%H:%M:%S)" "${2:-INFO}" "$1"; }

# ------------------------------------------------------------------- config
HOST="" ; PORT="8377" ; APIKEY=""
if [ -f "$CONFIG" ]; then
  eval "$(python3 - "$CONFIG" <<'PY'
import json, sys, shlex
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for k, var in (("host","HOST"), ("port","PORT"), ("apiKey","APIKEY")):
    v = d.get(k)
    if v:
        print(f"{var}={shlex.quote(str(v))}")
PY
)"
  log "Loaded config from $CONFIG"
else
  log "No config at $CONFIG - relying on environment" WARN
fi

HOST="${MEMORY_HOST:-$HOST}"
PORT="${MEMORY_PORT:-$PORT}"
APIKEY="${MEMORY_API_KEY:-$APIKEY}"

if [ -z "$HOST" ]; then
  log "Memory host not configured. Set \"host\" in $CONFIG or MEMORY_HOST." ERROR
  exit 1
fi
BASE="http://${HOST}:${PORT}"
log "Memory brain: $BASE"
log "Cowork folder: $OUT_DIR"

auth_args=()
[ -n "$APIKEY" ] && auth_args=(-H "X-Api-Key: $APIKEY")

write_stale() {
  mkdir -p "$OUT_DIR"
  {
    echo "# Snapshot is STALE"
    echo
    echo "The last refresh attempt FAILED, so the files in this folder are older than they look."
    echo
    echo "- Attempted: $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "- Reason: $1"
    echo
    echo "Treat every fact in this folder as unverified until this file disappears."
    echo "Check that the memory brain is running."
  } > "$OUT_DIR/_STALE.md"
  log "Wrote stale marker to $OUT_DIR/_STALE.md" WARN
}

# ----------------------------------------------------------------- preflight
if ! curl -sf -m 20 "$BASE/health" "${auth_args[@]}" >/dev/null 2>&1; then
  reason="Cannot reach $BASE/health"
  log "$reason" ERROR
  write_stale "$reason"
  exit 1
fi
log "Health check passed"

[ -f "$TOPICS" ] || { log "Topics file not found: $TOPICS" ERROR; exit 1; }

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

POLICY=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('policy',''))" "$TOPICS")
DEFAULT_K=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('defaultK',8))" "$TOPICS")
MAXCHARS=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('maxCharsPerDoc',6000))" "$TOPICS")
N_TOPICS=$(python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))['topics']))" "$TOPICS")

ok_count=0
: > "$STAGING/.sources"

for i in $(seq 0 $((N_TOPICS - 1))); do
  title=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['topics'][int(sys.argv[2])]['title'])" "$TOPICS" "$i")
  query=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['topics'][int(sys.argv[2])]['query'])" "$TOPICS" "$i")
  slug=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['topics'][int(sys.argv[2])]['slug'])" "$TOPICS" "$i")
  k=$(python3 -c "import json,sys;t=json.load(open(sys.argv[1]))['topics'][int(sys.argv[2])];print(t.get('k',sys.argv[3]))" "$TOPICS" "$i" "$DEFAULT_K")

  log "Querying '$slug' (k=$k)"
  body=$(python3 -c "
import json,sys
b={'query':sys.argv[1],'k':int(sys.argv[2])}
if sys.argv[3]: b['policy']=sys.argv[3]
print(json.dumps(b))" "$query" "$k" "$POLICY")

  resp=$(curl -s -m 60 -X POST "$BASE/search" "${auth_args[@]}" \
    -H "Content-Type: application/json" -d "$body" 2>/dev/null)

  if [ -z "$resp" ]; then
    log "  -> FAILED (no response)" ERROR
    continue
  fi

  # The response goes to a file, not a pipe: python's program itself arrives on
  # stdin via the heredoc, so piping JSON there too means the JSON never lands.
  printf '%s' "$resp" > "$STAGING/.resp.json"
  if ! python3 - "$STAGING/.resp.json" "$STAGING/$slug.md" "$title" "$query" "$POLICY" "$MAXCHARS" "$STAGING/.sources" <<'PY'
import json, sys, collections
respfile, out, title, query, policy, maxchars, srcfile = sys.argv[1:8]
maxchars = int(maxchars)
try:
    d = json.load(open(respfile, encoding="utf-8"))
except Exception as e:
    print(f"unparseable response: {e}", file=sys.stderr); sys.exit(1)
hits = d.get("hits") or []
if not hits:
    print("no hits", file=sys.stderr); sys.exit(1)

bydoc = collections.OrderedDict()
for h in hits:
    c = h.get("chunk") or {}
    p = c.get("notePath", "unknown")
    e = bydoc.setdefault(p, {"source": c.get("source",""), "updated": c.get("updated",""),
                             "score": h.get("score",0), "texts": []})
    e["texts"].append(c.get("text",""))

from datetime import datetime
lines = [f"# {title}", "",
         f"> Retrieved from the memory brain on {datetime.now():%Y-%m-%d %H:%M}"
         + (f" using policy `{policy}`." if policy else "."),
         f"> Query: *{query}*",
         f"> {len(hits)} chunks across {len(bydoc)} source documents.", ""]
for p, e in bydoc.items():
    text = "\n\n".join(e["texts"])
    if len(text) > maxchars:
        text = text[:maxchars] + "\n\n*[truncated]*"
    upd = (e["updated"] or "")[:10]
    lines += [f"## {p}", "", f"*source: {e['source']} | updated: {upd} | score: {round(e['score'],4)}*",
              "", text, "", "---", ""]
open(out, "w", encoding="utf-8").write("\n".join(lines))
with open(srcfile, "a", encoding="utf-8") as f:
    for p in bydoc: f.write(p + "\n")
print(f"{len(hits)} chunks / {len(bydoc)} docs")
PY
  then
    log "  -> FAILED" ERROR
    continue
  fi
  log "  -> done"
  ok_count=$((ok_count + 1))
done

if [ "$ok_count" -eq 0 ]; then
  reason="All $N_TOPICS topic queries failed."
  log "$reason" ERROR
  write_stale "$reason"
  exit 1
fi

# ------------------------------------------------------------------ manifest
sort -u "$STAGING/.sources" > "$STAGING/.sources.uniq"
n_src=$(wc -l < "$STAGING/.sources.uniq" | tr -d ' ')
{
  echo "# TSP proposal memory - snapshot"
  echo
  echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "**Source:** memory brain at $BASE"
  [ -n "$POLICY" ] && echo "**Retrieval policy:** \`$POLICY\`"
  echo
  echo "This is a point-in-time snapshot, not a live query. If the generated timestamp"
  echo "above is more than a few days old, say so before relying on it."
  echo
  echo "## Files"
  echo
  for f in "$STAGING"/*.md; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    [ "$b" = "_index.md" ] && continue
    echo "- \`$b\`"
  done
  echo
  echo "## Source documents in this snapshot ($n_src)"
  echo
  sed 's/^/- /' "$STAGING/.sources.uniq"
} > "$STAGING/_index.md"

# ------------------------------------------------------------------- swap in
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.md "$OUT_DIR/_status.json" 2>/dev/null
for f in "$STAGING"/*.md; do
  [ -e "$f" ] && mv "$f" "$OUT_DIR/"
done
rm -f "$OUT_DIR/_STALE.md"

log "Snapshot written: $ok_count/$N_TOPICS topics, $n_src source documents"
[ "$ok_count" -lt "$N_TOPICS" ] && { log "Some topics failed - see _index.md" WARN; exit 2; }
exit 0

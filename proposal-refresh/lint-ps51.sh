#!/usr/bin/env bash
# Lint PowerShell scripts for constructs that parse under pwsh 7 but fail on
# Windows PowerShell 5.1 — the version these scripts actually run on.
#
# Why this exists: pwsh 7's own parser is the only checker available on macOS,
# and it happily accepts 5.1-invalid syntax. A setup script shipped green here
# died on `param(...) <statement>` on one line the moment it hit the work
# laptop. This catches that class of mistake before it travels.
#
# Not a substitute for running on 5.1. It only knows the patterns listed below.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
report() {
  local desc="$1" pattern="$2"
  local hits
  hits=$(grep -rnE "$pattern" --include="*.ps1" . 2>/dev/null | grep -vE ':\s*#')
  if [ -n "$hits" ]; then
    echo "FAIL: $desc"
    echo "$hits" | sed 's/^/    /'
    fail=1
  else
    echo "  ok: $desc"
  fi
}

echo "PowerShell 5.1 compatibility lint"
echo

# 5.1 needs a newline or ';' after param(); pwsh 7 does not.
report "param() followed by a statement on the same line" \
  '^\s*function\s+\S+\s*\{\s*param\([^)]*\)\s*\S'

# Operators and parameters introduced in pwsh 6/7.
report "null-coalescing / null-conditional (?? ?. ??=)" \
  '\?\?|\?\?=|\$\w+\?\.'
report "ternary operator (a ? b : c)" \
  '^[^#]*\s\?\s.*\s:\s'
report "pipeline chain operators (&& ||)" \
  '^[^#]*(\|\||&&)\s'
report "ForEach-Object -Parallel" \
  'ForEach-Object\s+-Parallel'
report "ConvertFrom-Json -AsHashtable" \
  'ConvertFrom-Json[^|]*-AsHashtable'
report "Get-Content -AsByteStream (5.1 uses -Encoding Byte)" \
  'Get-Content[^|]*-AsByteStream'
report "Test-Json / Get-Uptime / Join-String (7+ cmdlets)" \
  '\b(Test-Json|Get-Uptime|Join-String)\b'

# Encoding. 5.1 reads a BOM-less file as Windows-1252, so UTF-8 multi-byte
# characters mojibake. An em-dash (E2 80 94) becomes 'a EUR "' whose last byte is
# U+201D — a right curly quote, which PowerShell accepts as a STRING DELIMITER.
# That opens an unterminated string and the parse dies with MissingEndCurlyBrace
# pointing at unrelated lines. Belt and braces: keep scripts ASCII AND add a BOM.
nonascii=0
for f in $(find . -name "*.ps1"); do
  # Strip the BOM before checking, or it reports itself.
  body=$(mktemp)
  if [ "$(head -c 3 "$f" | xxd -p)" = "efbbbf" ]; then tail -c +4 "$f" > "$body"; else cp "$f" "$body"; fi
  if LC_ALL=C grep -q '[^ -~	]' "$body"; then
    echo "FAIL: non-ASCII characters (mojibake into string delimiters on 5.1)"
    LC_ALL=C grep -n '[^ -~	]' "$body" | head -5 | sed "s|^|    $f:|"
    fail=1; nonascii=1
  fi
  rm -f "$body"
done
[ "$nonascii" -eq 0 ] && echo "  ok: ASCII-only (BOM excluded)"

for f in $(find . -name "*.ps1"); do
  if [ "$(head -c 3 "$f" | xxd -p)" != "efbbbf" ]; then
    echo "FAIL: missing UTF-8 BOM — 5.1 will guess Windows-1252"
    echo "    $f"
    fail=1
  fi
done

# $args is an automatic variable; assigning to it is legal but shadows it and
# interacts badly with StrictMode.
report "assignment to the automatic variable \$args" \
  '^\s*\$args\s*='

echo
if [ "$fail" -ne 0 ]; then
  echo "5.1 incompatibilities found."
  exit 1
fi
echo "No known 5.1 incompatibilities."

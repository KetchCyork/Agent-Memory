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

echo
if [ "$fail" -ne 0 ]; then
  echo "5.1 incompatibilities found."
  exit 1
fi
echo "No known 5.1 incompatibilities."

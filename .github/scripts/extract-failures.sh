#!/usr/bin/env bash
# extract-failures.sh <input-json> <output-txt>
# Parses vitest JSON reporter output and emits:
#   FAIL <relative-file-path>
#   AssertionError: <first line of failure message>
# for each failed test. Exit 0 always (idempotent).

set -euo pipefail

INPUT_JSON="${1:?Usage: extract-failures.sh <input-json> <output-txt>}"
OUTPUT_TXT="${2:?Usage: extract-failures.sh <input-json> <output-txt>}"

if [ ! -f "$INPUT_JSON" ]; then
  echo "No test results file found at $INPUT_JSON, skipping extraction" >&2
  touch "$OUTPUT_TXT"
  exit 0
fi

# Get repo root to make paths relative
REPO_ROOT="$(git -C "$(dirname "$INPUT_JSON")" rev-parse --show-toplevel 2>/dev/null || pwd)"

jq -r --arg repo_root "$REPO_ROOT" '
  .testResults[]?
  | select(.status == "failed")
  | . as $file
  | (
      .name
      | if startswith($repo_root) then .[$repo_root | length + 1:] else . end
    ) as $rel_path
  | "FAIL \($rel_path)",
    (
      $file.assertionResults[]?
      | select(.status == "failed")
      | .failureMessages[0]? // ""
      | split("\n")[0]
      | if . != "" then . else empty end
    )
' "$INPUT_JSON" > "$OUTPUT_TXT" 2>/dev/null || true

exit 0

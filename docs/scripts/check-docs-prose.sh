#!/usr/bin/env bash
set -euo pipefail

# Docs prose linter. Fails when a docs/*.mdx file contains banned words or
# patterns from the docs-writing-rules. Diff-scoped by default: in CI it
# checks only added or modified .mdx files; pass --all to check the whole
# docs/ tree (useful for a one-off sweep).
#
# The word list comes from docs-writing-rules (rules 3, 10, 17) and the
# house-wide bans in CLAUDE.md. Add new entries to PATTERNS below.

DOCS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DOCS_DIR/.." && pwd)"

# Patterns: one per line, extended-regex. The regex runs case-insensitive
# against each line of each file. Lines inside code fences (``` blocks) and
# {/* Founder decision: */} exempted lines are skipped before matching.
#
# Each entry is  PATTERN<tab>LABEL  so the error message says which rule fired.
PATTERNS=$(cat <<'RULES'
—	em dash (use comma, colon, or period)
–	en dash (use hyphen)
\bpowerful\b	banned marketing word (rule 3)
\bseamless(ly)?\b	banned marketing word (rule 3)
\brobust\b	banned marketing word (rule 3)
\beffortless(ly)?\b	banned marketing word (rule 3)
\bcutting[- ]edge\b	banned marketing word (rule 3)
\bunlock\b	banned marketing word (rule 3)
\bleverage\b	banned marketing word (rule 3)
\bsimply\b	banned marketing word (rule 3)
\beasily\b	banned marketing word (rule 3)
\bblazing[- ]fast\b	banned marketing word (rule 3)
\benterprise[- ]grade\b	banned marketing word (rule 3)
\bworld[- ]class\b	banned marketing word (rule 3)
\bload[- ]bearing\b	house-wide banned phrase
\bsurface area\b	house-wide banned phrase
\bimpedance mismatch\b	house-wide banned phrase
\bfirst[- ]order\b	house-wide banned phrase
\bhinges on\b	house-wide banned phrase
\bnobody can\b	house-wide banned phrase
\bnothing\b	vague: state what is absent or what does not happen
RULES
)

# GitHub reads an ::error line as a workflow command, so a value that reaches
# one is percent-encoded first. A docs line holding a carriage return would
# otherwise end the annotation early, and one holding a percent sign would read
# as an encoded character. A property value carries a colon and a comma too,
# which are what separate the properties.
encode_data() {
  local value="$1"
  value="${value//%/%25}"
  value="${value//$'\r'/%0D}"
  value="${value//$'\n'/%0A}"
  printf '%s' "$value"
}

encode_property() {
  local value
  value="$(encode_data "$1")"
  value="${value//:/%3A}"
  value="${value//,/%2C}"
  printf '%s' "$value"
}

MODE="diff"
if [[ "${1:-}" == "--all" ]]; then
  MODE="all"
fi

# Collect the file list.
if [[ "$MODE" == "all" ]]; then
  mapfile -t FILES < <(find "$DOCS_DIR" -name '*.mdx' -not -path '*/api-reference/*' | sort)
else
  BASE="${DOCS_PROSE_BASE:-origin/main}"
  mapfile -t FILES < <(
    git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR "$BASE" -- 'docs/*.mdx' \
      | sed "s|^|$REPO_ROOT/|" \
      | sort
  )
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No docs files to check."
  exit 0
fi

ERRORS=0

for file in "${FILES[@]}"; do
  [[ -f "$file" ]] || continue
  rel="${file#"$REPO_ROOT"/}"

  # Blank out code fences (including indented ones, up to 3 spaces per the
  # CommonMark spec) and founder-decision exemptions. Print blank lines for
  # skipped records so grep -n reports the real source line number.
  cleaned=$(awk '
    /^ {0,3}(`{3,}|~{3,})/ { in_code = !in_code; print ""; next }
    in_code                 { print ""; next }
    /\{\/\* Founder decision:/  { print ""; next }
    { print }
  ' "$file")

  while IFS=$'\t' read -r pattern label; do
    [[ -z "$pattern" ]] && continue
    matches=$(echo "$cleaned" | grep -niE "$pattern") || rc=$?
    rc="${rc:-0}"
    if [[ $rc -gt 1 ]]; then
      echo "::error file=$(encode_property "$rel")::grep failed (exit $rc) on pattern: $(encode_data "$pattern")"
      ERRORS=$((ERRORS + 1))
      continue
    fi
    if [[ -n "${matches:-}" ]]; then
      while IFS= read -r match; do
        lineno="${match%%:*}"
        text="${match#*:}"
        word=$(printf '%s' "$text" | grep -oiE "$pattern" | head -1)
        echo "::error file=$(encode_property "$rel"),line=$lineno::The word \"$(encode_data "$word")\" is forbidden ($label). Read https://nexus.langwatch.ai/wiki/docs-writing-rules to learn how to write better docs. Load your nexus access skill to read it; if you do not have one or do not know how to access Nexus, ask your user for access so you can pass this CI check. Line: $(encode_data "$text")"
        ERRORS=$((ERRORS + 1))
      done <<< "$matches"
    fi
  done <<< "$PATTERNS"
done

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "Found $ERRORS banned-word violation(s) in docs/. See docs-writing-rules on Nexus."
  exit 1
fi

echo "Docs prose check passed (${#FILES[@]} file(s) checked)."

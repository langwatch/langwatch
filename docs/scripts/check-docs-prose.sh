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

  # Strip code fences and founder-decision exemptions before matching.
  cleaned=$(awk '
    /^```/      { in_code = !in_code; next }
    in_code     { next }
    /\{\/\* Founder decision:/ { next }
    { print }
  ' "$file")

  while IFS=$'\t' read -r pattern label; do
    [[ -z "$pattern" ]] && continue
    # Match with line numbers from the cleaned content.
    matches=$(echo "$cleaned" | grep -niE "$pattern" || true)
    if [[ -n "$matches" ]]; then
      while IFS= read -r match; do
        echo "::error file=$rel::$match  [$label]"
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

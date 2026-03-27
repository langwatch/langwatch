#!/bin/bash
# Regenerate docs/snippets/prompts-data.jsx from compiled skill prompts.
# Run from the repo root: bash docs/scripts/sync-prompts.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Step 1: Compile the skill sources into .txt files
echo "Running skills/_compiled/generate.sh..."
bash skills/_compiled/generate.sh

# Step 2: Convert compiled .txt files into prompts-data.jsx
OUT="docs/snippets/prompts-data.jsx"
COMPILED_DIR="skills/_compiled"

escape_for_template_literal() {
  # Escape backticks and ${
  sed -e 's/`/\\`/g' -e 's/\${/\\${/g'
}

cat > "$OUT" <<'HEADER'
// Auto-generated — do not edit manually.
// Regenerate with: bash docs/scripts/sync-prompts.sh

export const PROMPTS = {
HEADER

# --- .docs.txt files ---

# Mapping: filename-stem → JS key
declare -A DOCS_KEY_MAP
DOCS_KEY_MAP=(
  [tracing]="tracing"
  [evaluations]="evaluations"
  [scenarios]="scenarios"
  [prompts]="prompts"
  [analytics]="analytics"
  [level-up]="level_up"
  [recipes-debug-instrumentation]="recipe_debug_instrumentation"
  [recipes-improve-setup]="recipe_improve_setup"
  [recipes-evaluate-multimodal]="recipe_evaluate_multimodal"
  [recipes-generate-rag-dataset]="recipe_generate_rag_dataset"
  [recipes-test-compliance]="recipe_test_compliance"
  [recipes-test-cli-usability]="recipe_test_cli_usability"
)

# Ordered list for deterministic output
DOCS_ORDER="tracing evaluations scenarios prompts analytics level-up recipes-debug-instrumentation recipes-improve-setup recipes-evaluate-multimodal recipes-generate-rag-dataset recipes-test-compliance recipes-test-cli-usability"

for stem in $DOCS_ORDER; do
  file="$COMPILED_DIR/${stem}.docs.txt"
  key="${DOCS_KEY_MAP[$stem]}"
  if [ -f "$file" ] && [ -n "$key" ]; then
    content=$(escape_for_template_literal < "$file")
    printf '  %s: `%s`,\n\n' "$key" "$content" >> "$OUT"
  else
    echo "ERROR: Missing file or key for $stem" >&2; exit 1
  fi
done

# --- .platform.txt files (only the 3 that the platform-prompts page uses) ---

# The platform page uses: platform_analytics, platform_scenarios, platform_evaluators
# Filenames:            analytics.platform.txt, scenarios.platform.txt, evaluations.platform.txt
printf '  // Platform prompts (from .platform.txt files)\n' >> "$OUT"

declare -A PLATFORM_KEY_MAP
PLATFORM_KEY_MAP=(
  [analytics]="platform_analytics"
  [scenarios]="platform_scenarios"
  [evaluations]="platform_evaluators"
)

PLATFORM_ORDER="analytics scenarios evaluations"

for stem in $PLATFORM_ORDER; do
  file="$COMPILED_DIR/${stem}.platform.txt"
  key="${PLATFORM_KEY_MAP[$stem]}"
  if [ -f "$file" ] && [ -n "$key" ]; then
    content=$(escape_for_template_literal < "$file")
    printf '  %s: `%s`,\n\n' "$key" "$content" >> "$OUT"
  else
    echo "ERROR: Missing platform file or key for $stem" >&2; exit 1
  fi
done

# Close the object
echo "};" >> "$OUT"

echo "Generated $OUT"

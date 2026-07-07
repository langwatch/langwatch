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

docs_key_for() {
  case "$1" in
    tracing) echo "tracing" ;;
    evaluations) echo "evaluations" ;;
    experiments) echo "experiments" ;;
    scenarios) echo "scenarios" ;;
    prompts) echo "prompts" ;;
    analytics) echo "analytics" ;;
    datasets) echo "datasets" ;;
    level-up) echo "level_up" ;;
    recipes-debug-instrumentation) echo "recipe_debug_instrumentation" ;;
    recipes-improve-setup) echo "recipe_improve_setup" ;;
    recipes-evaluate-multimodal) echo "recipe_evaluate_multimodal" ;;
    recipes-generate-rag-dataset) echo "recipe_generate_rag_dataset" ;;
    recipes-test-compliance) echo "recipe_test_compliance" ;;
    recipes-test-cli-usability) echo "recipe_test_cli_usability" ;;
    *) return 1 ;;
  esac
}

platform_key_for() {
  case "$1" in
    analytics) echo "platform_analytics" ;;
    scenarios) echo "platform_scenarios" ;;
    evaluations) echo "platform_evaluators" ;;
    *) return 1 ;;
  esac
}

cat > "$OUT" <<'HEADER'
// Auto-generated — do not edit manually.
// Regenerate with: bash docs/scripts/sync-prompts.sh

export const PROMPTS = {
HEADER

# --- .docs.txt files ---

# Ordered list for deterministic output
DOCS_ORDER="tracing evaluations experiments scenarios prompts analytics datasets level-up recipes-debug-instrumentation recipes-improve-setup recipes-evaluate-multimodal recipes-generate-rag-dataset recipes-test-compliance recipes-test-cli-usability"

for stem in $DOCS_ORDER; do
  file="$COMPILED_DIR/${stem}.docs.txt"
  key="$(docs_key_for "$stem" || true)"
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

PLATFORM_ORDER="analytics scenarios evaluations"

for stem in $PLATFORM_ORDER; do
  file="$COMPILED_DIR/${stem}.platform.txt"
  key="$(platform_key_for "$stem" || true)"
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

#!/bin/bash
# Generate compiled prompts from SKILL.md sources.
# Run from the repo root: bash skills/_compiled/generate.sh

set -e

# tsx comes from the skills workspace member (single root pnpm workspace).
TSX="skills/node_modules/.bin/tsx"
COMPILER="$TSX skills/_compiler/compile.ts"
OUT_DIR="skills/_compiled"

SKILLS="tracing evaluations scenarios prompts analytics level-up datasets"

for skill in $SKILLS; do
  echo "Compiling $skill..."
  $COMPILER --skills "$skill" --mode platform > "$OUT_DIR/$skill.platform.txt"
  $COMPILER --skills "$skill" --mode docs > "$OUT_DIR/$skill.docs.txt"
done

RECIPES="debug-instrumentation improve-setup evaluate-multimodal generate-rag-dataset test-compliance test-cli-usability"

for recipe in $RECIPES; do
  echo "Compiling recipe $recipe..."
  $COMPILER --skills "recipes/$recipe" --mode docs > "$OUT_DIR/recipes-$recipe.docs.txt"
done

echo "Done. Generated $(ls -1 $OUT_DIR/*.txt 2>/dev/null | wc -l) files in $OUT_DIR/"

# Native opencode skills — one <name>/SKILL.md per canonical skill, consumed by
# the langyagent image so the in-product assistant loads exactly what the
# public skill directory publishes (see skills/_compiler/native.ts).
echo "Generating native (opencode) skills..."
"$TSX" skills/_compiler/native.ts

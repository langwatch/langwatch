#!/bin/bash
# Generate compiled prompts from SKILL.md sources.
# Run from the repo root: bash skills/_compiled/generate.sh

set -e

COMPILER="npx tsx skills/_compiler/compile.ts"
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

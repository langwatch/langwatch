#!/bin/bash
# Generate compiled prompts from SKILL.md sources.
# Run from the repo root: bash skills/_compiled/generate.sh

set -e

# tsx comes from skills/'s own devDependencies, invoked by path rather than
# through `npx`. npx resolves binaries by walking up from the cwd, and this
# script runs from the repo root, where tsx has never been a dependency — it
# only ever worked because npx silently downloaded tsx from the registry on
# each run. That fallback stopped being reachable once the repo gained a root
# .npmrc (ADR-076): npm reads it, does not recognise pnpm's settings, and the
# install it would have done fails, leaving `tsx: not found`.
#
# Invoking the workspace's own binary is both faster and reproducible. The cwd
# stays the repo root, which is what compile.ts's paths are relative to.
TSX="skills/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  echo "✗ $TSX missing — run: pnpm install --filter @langwatch/skills..." >&2
  exit 1
fi
COMPILER="$TSX skills/_compiler/compile.ts"
OUT_DIR="skills/_compiled"

SKILLS="tracing experiments online-evaluations evaluations scenarios prompts agent-performance agent-improve level-up datasets"

for skill in $SKILLS; do
  echo "Compiling $skill..."
  $COMPILER --skills "$skill" --mode platform > "$OUT_DIR/$skill.platform.txt"
  $COMPILER --skills "$skill" --mode docs > "$OUT_DIR/$skill.docs.txt"
done

RECIPES="debug-instrumentation agent-best-practices debug-with-langwatch eval-triage setup-lw evaluate-multimodal generate-rag-dataset test-compliance test-cli-usability"

for recipe in $RECIPES; do
  echo "Compiling recipe $recipe..."
  $COMPILER --skills "recipes/$recipe" --mode docs > "$OUT_DIR/recipes-$recipe.docs.txt"
done

echo "Done. Generated $(ls -1 $OUT_DIR/*.txt 2>/dev/null | wc -l) files in $OUT_DIR/"

# Native opencode skills — one <name>/SKILL.md per canonical skill, consumed by
# the langyagent image so the in-product assistant loads exactly what the
# public skill directory publishes (see skills/_compiler/native.ts).
echo "Generating native (opencode) skills..."
npx tsx skills/_compiler/native.ts

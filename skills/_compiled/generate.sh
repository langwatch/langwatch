#!/bin/bash
# Generate compiled prompts from SKILL.md sources.
# Run from the repo root: bash skills/_compiled/generate.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPILER="npx tsx $REPO_ROOT/skills/_compiler/compile.ts"
OUT_DIR="$SCRIPT_DIR"

# Discover all skills (directories under skills/ that contain SKILL.md)
SKILLS=$(find "$REPO_ROOT/skills" -maxdepth 2 -name "SKILL.md" -exec dirname {} \; | xargs -I {} basename {} | sort)

for skill in $SKILLS; do
  echo "Compiling $skill..."
  $COMPILER --skills "$skill" --mode platform > "$OUT_DIR/$skill.platform.txt"
  $COMPILER --skills "$skill" --mode docs > "$OUT_DIR/$skill.docs.txt"
done

echo "Done. Generated $(ls -1 "$OUT_DIR"/*.txt 2>/dev/null | wc -l | tr -d ' ') files in $OUT_DIR/"

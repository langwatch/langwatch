#!/bin/bash
set -e

TARGET_DIR="${1:?Usage: sync.sh <path-to-skills-repo>}"

echo "Syncing skills to $TARGET_DIR..."

# Clean target (except .git and README)
find "$TARGET_DIR" -maxdepth 1 -type d ! -name '.git' ! -name '.' | while read dir; do
  rm -rf "$dir"
done

# Feature skills
for skill in tracing evaluations scenarios prompts analytics level-up; do
  if [ -f "skills/$skill/SKILL.md" ]; then
    mkdir -p "$TARGET_DIR/$skill"
    cp "skills/$skill/SKILL.md" "$TARGET_DIR/$skill/SKILL.md"
    echo "  ✓ $skill"
  fi
done

# Recipes
for recipe in skills/recipes/*/SKILL.md; do
  name=$(basename $(dirname "$recipe"))
  mkdir -p "$TARGET_DIR/recipes/$name"
  cp "$recipe" "$TARGET_DIR/recipes/$name/SKILL.md"
  echo "  ✓ recipes/$name"
done

echo "Done."

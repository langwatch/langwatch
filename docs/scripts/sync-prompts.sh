#!/bin/bash
# Regenerate the skill accordions inside docs/skills pages from compiled
# skill prompts. Run from the repo root: bash docs/scripts/sync-prompts.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Step 1: Compile the skill sources into .txt files
echo "Running skills/_compiled/generate.sh..."
bash skills/_compiled/generate.sh

# Step 2: Expand the accordion markup into the docs/skills pages, between
# the lw-generated markers, from docs/skills/skills-pages-manifest.json.
node docs/scripts/generate-skills-pages.mjs

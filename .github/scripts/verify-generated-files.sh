#!/usr/bin/env bash
#
# Asserts that `start:prepare:files` produced everything a job depends on.
#
# The prepare-generated-files action skips the generators on a cache hit, so a
# key that has quietly stopped covering one of them would restore a partial
# result and let the job continue. The failure then lands minutes later as
# "Cannot find module '.prisma/client'" inside a test worker, which points at
# everything except the cache that caused it.
#
# Checking here turns that into a named failure at the step that owns it. It is
# cheap and it runs on hit and miss alike: a miss that generated nothing is
# every bit as broken as a hit that restored nothing.
set -euo pipefail

missing=()

require_file() {
  [ -f "$1" ] || missing+=("$1")
}

require_dir() {
  [ -d "$1" ] || missing+=("$1/")
}

require_file "platform/app/src/server/evaluations/evaluators.generated.ts"
require_file "platform/app/src/tasks.generated.ts"
require_file "platform/app/src/shared/langy/langySkills.generated.json"

# Name the ENTRYPOINTS, not just the directories that hold them. A directory
# check passes for an empty or half-written one, so a partially restored cache
# would clear this step and then fail minutes later inside a test worker — the
# exact failure this script exists to pre-empt. These are the paths the
# packages' own `main` / `exports` / `bin` fields point at, so if one is missing
# the package is unusable regardless of what else survived.
require_file "sdks/typescript/dist/index.js"
require_file "sdks/typescript/dist/index.mjs"
require_file "sdks/typescript/dist/index.d.ts"
require_file "mcp/typescript/dist/index.js"

# `generator client { output = "../src/generated/prisma" }` — this schema does
# NOT use the default node_modules/.prisma location, and app code imports it as
# `~/generated/prisma/client`.
require_dir "platform/app/src/generated/prisma"
require_file "platform/app/src/generated/prisma/client.ts"

if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::start:prepare:files did not produce these outputs:"
  printf '::error::  %s\n' "${missing[@]}"
  echo "::error::If they are freshly added, add their inputs to the cache key in"
  echo "::error::.github/actions/prepare-generated-files/action.yml and their paths here."
  exit 1
fi

echo "All generated files present."

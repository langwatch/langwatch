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
require_dir "sdks/typescript/dist"
require_dir "mcp/typescript/dist"
# `generator client { output = "../src/generated/prisma" }` — this schema does
# NOT use the default node_modules/.prisma location, and app code imports it as
# `~/generated/prisma/client`.
require_dir "platform/app/src/generated/prisma"

if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::start:prepare:files did not produce these outputs:"
  printf '::error::  %s\n' "${missing[@]}"
  echo "::error::If they are freshly added, add their inputs to the cache key in"
  echo "::error::.github/actions/prepare-generated-files/action.yml and their paths here."
  exit 1
fi

echo "All generated files present."

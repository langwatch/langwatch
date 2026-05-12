#!/bin/bash
# Silent wrapper around `pnpm --filter @langwatch/mcp-server run build`.
# Called from `pnpm run start:prepare:files` — the full tsup + esbuild
# output is noise in that context. Prints one line with the elapsed time,
# or the full captured output on failure.

set -eo pipefail

printf 'building mcp server... '
start=$(node -e 'console.log(Date.now())')

if ! output=$(pnpm --silent --filter @langwatch/mcp-server run build 2>&1); then
  printf 'FAILED\n'
  printf '%s\n' "$output"
  exit 1
fi

elapsed=$(node -e "console.log(((Date.now() - $start) / 1000).toFixed(1))")
printf 'built in %ss\n' "$elapsed"

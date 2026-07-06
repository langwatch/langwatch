#!/bin/bash
# Silent wrapper around `pnpm --filter @langwatch/mcp-server run build`.
# Called from `pnpm run start:prepare:files` — the full tsup + esbuild
# output is noise in that context. Prints one line with the elapsed time,
# or the full captured output on failure.

set -eo pipefail

printf 'building mcp server... '
start=$(node -e 'console.log(Date.now())' 2>/dev/null)

# Self-heal a half-linked mcp-server/node_modules. An interrupted prep run
# (Ctrl-C, OOM, the compose-v5 crash) can leave the `.bin/tsup` symlink in
# place while the `tsup` package files never finish linking. The next
# `pnpm install` then reports "Lockfile is up to date" and skips repair, so
# this build dies with `Cannot find module '.../tsup/dist/cli-default.js'`.
# Re-link the workspace deps from the store when tsup's entrypoint is absent
# — the exact one-liner we'd otherwise run by hand, made automatic.
mcp_tsup="$(cd "$(dirname "$0")/../.." && pwd)/mcp-server/node_modules/tsup/dist/cli-default.js"
if [ ! -e "$mcp_tsup" ]; then
  printf '(repairing deps) '
  if ! repair_output=$(pnpm --filter @langwatch/mcp-server install 2>&1); then
    printf 'FAILED\n'
    printf '%s\n' "$repair_output"
    exit 1
  fi
fi

if ! output=$(pnpm --silent --filter @langwatch/mcp-server run build 2>&1); then
  printf 'FAILED\n'
  printf '%s\n' "$output"
  exit 1
fi

elapsed=$(node -e "console.log(((Date.now() - $start) / 1000).toFixed(1))")
printf 'built in %ss\n' "$elapsed"

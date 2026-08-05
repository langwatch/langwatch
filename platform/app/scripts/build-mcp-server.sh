#!/bin/bash
# Silent wrapper around `pnpm --filter @langwatch/mcp-server run build`.
# Called from `pnpm run start:prepare:files` — the full tsup + esbuild
# output is noise in that context. Prints one line with the elapsed time,
# or the full captured output on failure.

set -eo pipefail

printf 'building mcp server... '

# The published @langwatch/server artifact ships mcp-server PRE-BUILT and
# deliberately excludes its build config (see mcp/typescript/.npmignore): there
# is nothing to build from, and the shipped dist is the thing to use. Only
# a tree that carries the build config gets rebuilt.
mcp_root="$(cd "$(dirname "$0")/../../.." && pwd)/mcp/typescript"
if [ ! -f "$mcp_root/tsup.config.ts" ]; then
  if [ -f "$mcp_root/dist/create-mcp-server.js" ]; then
    printf 'prebuilt in published artifact, skipping\n'
    exit 0
  fi
  printf 'FAILED\n'
  printf 'mcp-server has neither its build config nor a prebuilt dist — the artifact is incomplete (packaging bug in @langwatch/server).\n'
  exit 1
fi
# process.stdout.write, not console.log: under `pnpm dev` concurrently sets
# FORCE_COLOR, and console.log wraps numbers in ANSI colour codes even when
# piped — which then get interpolated into the elapsed-time eval below.
start=$(node -e 'process.stdout.write(String(Date.now()))' 2>/dev/null)

# Self-heal a half-linked mcp/typescript/node_modules. An interrupted prep run
# (Ctrl-C, OOM, the compose-v5 crash) can leave the `.bin/tsup` symlink in
# place while the `tsup` package files never finish linking. The next
# `pnpm install` then reports "Lockfile is up to date" and skips repair, so
# this build dies with `Cannot find module '.../tsup/dist/cli-default.js'`.
# Re-link the workspace deps from the store when tsup's entrypoint is absent
# — the exact one-liner we'd otherwise run by hand, made automatic.
mcp_tsup="$(cd "$(dirname "$0")/../../.." && pwd)/mcp/typescript/node_modules/tsup/dist/cli-default.js"
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

elapsed=$(node -e "process.stdout.write(((Date.now() - $start) / 1000).toFixed(1))")
printf 'built in %ss\n' "$elapsed"

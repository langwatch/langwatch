#!/usr/bin/env bash
# Runs the architecture enforcer through its Go front (cmd/enforcer): the
# ported policies in Go, the rest delegated to the TS CLI in one Node process,
# one report. Without Go it runs the TS CLI alone, which reports the same.
# Arguments pass through; relative paths resolve against the caller's cwd.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if command -v go >/dev/null 2>&1; then
  go -C "$root" build -o "$root/.bin/enforcer/enforcer" ./cmd/enforcer
  exec "$root/.bin/enforcer/enforcer" "$@"
fi
exec node --disable-warning=ExperimentalWarning --experimental-transform-types \
  "$root/packages/architecture-enforcer/src/cli.ts" "$@"

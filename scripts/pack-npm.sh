#!/usr/bin/env bash
#
# Pack the @langwatch/server npm tarball.
#
# Thin wrapper around `pnpm pack` that always runs from the repo root, so
# callers don't need to think about cwd. Args are forwarded to pnpm pack
# (e.g. `--pack-destination _pack`).
#
# Used by:
#   - .github/workflows/npx-server-publish.yml (CI publish)
#   - manual local publish

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ running: pnpm pack $*"
pnpm pack "$@"

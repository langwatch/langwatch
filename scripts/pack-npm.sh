#!/usr/bin/env bash
#
# Pack the @langwatch/server npm tarball.
#
# Wrapper around `pnpm pack` that always runs from the repo root, so callers
# don't need to think about cwd. Args are forwarded to pnpm pack (e.g.
# `--pack-destination _pack`).
#
# WHY the langwatch lockfile dance: the whole repo is ONE pnpm workspace with a
# single root pnpm-lock.yaml (see pnpm-workspace.yaml). But the published
# tarball ships langwatch/ as source and, on first boot, runs
# `pnpm -C langwatch install --frozen-lockfile`
# (packages/server/src/services/node-deps.ts) with NO ancestor workspace on the
# user's machine — so langwatch/ must carry a self-contained, langwatch-rooted
# pnpm-workspace.yaml + pnpm-lock.yaml. We do NOT commit those (single source of
# truth = the root workspace); instead we DERIVE them here at pack time and
# remove them again afterwards. pnpm roots at the nearest pnpm-workspace.yaml,
# so `pnpm -C langwatch install` uses the derived langwatch/ workspace even with
# the root workspace present.
#
# Used by:
#   - .github/workflows/npx-server-publish.yml (CI publish)
#   - manual local publish

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

readonly LW_WS="$ROOT/langwatch/pnpm-workspace.yaml"
readonly LW_LOCK="$ROOT/langwatch/pnpm-lock.yaml"

cleanup() {
  rm -f "$LW_WS" "$LW_LOCK"
}
trap cleanup EXIT

echo "→ deriving standalone langwatch workspace + lockfile for the tarball"
# The langwatch tarball workspace = langwatch itself + its sibling mcp-server
# (langwatch depends on @langwatch/mcp-server via workspace:*). langwatch's own
# packages/* are .npmignore'd out of the tarball, so they are NOT members here.
# Everything after `packages:` in the root workspace (overrides,
# onlyBuiltDependencies, packageExtensions, minimumReleaseAge) is copied so the
# derived lockfile resolves the SAME versions the workspace was tested against.
{
  printf 'packages:\n  - .\n  - ../mcp-server\n\n'
  awk '/^minimumReleaseAge:/{f=1} f{print}' "$ROOT/pnpm-workspace.yaml"
} > "$LW_WS"

# --lockfile-only: resolve + write langwatch/pnpm-lock.yaml without linking.
# --ignore-scripts: we only need the lockfile, not built native modules.
pnpm -C "$ROOT/langwatch" install --lockfile-only --ignore-scripts

echo "→ running: pnpm pack $*"
pnpm pack "$@"

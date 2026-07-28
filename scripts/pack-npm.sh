#!/usr/bin/env bash
#
# Pack the @langwatch/server npm tarball.
#
# Assembles a staging tree and packs THAT, rather than packing the repo in
# place. Args are forwarded to `pnpm pack` (e.g. `--pack-destination _pack`).
#
# Used by:
#   - .github/workflows/npx-server-publish.yml (CI publish)
#   - manual local publish
#
# ---------------------------------------------------------------------------
# Why a staging tree (ADR-076)
#
# Packing in place made the artifact's layout a mirror of the repo's, and that
# coupling broke the moment the repo became a single pnpm workspace: npm
# deletes `pnpm-lock.yaml` from the package ROOT unconditionally (the same
# hardcoded rule that eats `.npmrc`), and a single workspace puts the lockfile
# exactly there. Without it the end user's first boot has nothing for
# `--frozen-lockfile` to check and the install stops being reproducible.
#
# The exclusion is root-only — a lockfile one directory down ships fine — so
# the whole artifact is staged under `app/`. That is also the layout the CLI
# already expects: locatePackageSource() finds the app root by walking up for
# `langwatch/package.json`, so nesting is transparent to it (see
# packages/server/src/services/app-dir.ts).
#
# `files` in package.json stays the single source of truth for WHAT ships;
# this script only decides WHERE it lands.
# ---------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# The CLI bundle is the package's entrypoint; packing without it produces a
# tarball whose `bin` dangles and which fails at `npx` time, not at pack time.
if [ ! -f "packages/server/dist/cli.cjs" ]; then
  echo "✗ packages/server/dist/cli.cjs missing — run 'pnpm build:cli' first" >&2
  exit 1
fi
if [ ! -f "pnpm-lock.yaml" ]; then
  echo "✗ pnpm-lock.yaml missing — the artifact must ship a lockfile" >&2
  exit 1
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/langwatch-pack.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/app"
mkdir -p "$APP"

# Trimming that used to live in the two .npmignore files. Stated once, here,
# where it is visible next to the copy that applies it.
EXCLUDES=(
  --exclude=node_modules
  --exclude=.git
  --exclude=__tests__
  --exclude=__pycache__
  --exclude=.pytest_cache
  --exclude=.venv
  --exclude=tests
  --exclude=test
  --exclude=notebooks
  --exclude=coverage
  --exclude=test-results
  --exclude=playwright-report
  --exclude=blob-report
  --exclude=reports
  --exclude=Dockerfile*
  --exclude=.dockerignore
  --exclude=.github
  --exclude=*.map
  --exclude=*.tsbuildinfo
  --exclude=.DS_Store
  --exclude=.vscode
  --exclude=.idea
  --exclude=.env
  --exclude=.env.local
  --exclude=.env.*.local
  --exclude=.sentryclirc
  --exclude=server.log
  --exclude=licenses.json
  --exclude=prisma/db.sqlite*
  --exclude=e2e/auth.json
)

# Everything `files` lists, copied into app/ so the workspace root sits one
# level below the package root.
#
# Trailing slashes are stripped before rsync sees the path: `rsync -a src/ dst/`
# copies the CONTENTS of src, `rsync -a src dst/` copies src itself. The `files`
# list writes directories both ways, and only the latter is wanted here — with
# the slash left on, packages/server/dist/ lands as app/packages/server/cli.cjs.
#
# A while-read loop rather than mapfile: mapfile is bash 4+, and macOS still
# ships bash 3.2, so a local `pnpm pack:npm` would die on it.
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  entry="${entry%/}"
  # npm skips a `files` entry that doesn't exist rather than failing, so this
  # matches it. Warn loudly though: a silently-skipped entry is how a stale
  # list goes unnoticed (packages/server/templates/ sat here for a long time
  # naming a directory that was never in the tree).
  if [ ! -e "$entry" ]; then
    echo "⚠ files entry does not exist, skipping: $entry" >&2
    continue
  fi
  mkdir -p "$APP/$(dirname "$entry")"
  rsync -a "${EXCLUDES[@]}" "$ROOT/$entry" "$APP/$(dirname "$entry")/"
done < <(node -p "require('./package.json').files.join('\n')")

# The workspace root's own manifest. pnpm resolves the lockfile's `.` importer
# against it, so `--frozen-lockfile` fails without it.
cp "$ROOT/package.json" "$APP/package.json"

# The published manifest. Same package, but its entrypoint and file list
# describe the staged layout rather than the repo's.
node -e '
  const fs = require("node:fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.bin = { "langwatch-server": "app/packages/server/dist/cli.cjs" };
  pkg.files = ["app"];
  delete pkg.scripts;
  fs.writeFileSync(process.argv[1], JSON.stringify(pkg, null, 2) + "\n");
' "$STAGE/package.json"

# npm auto-includes these at the package root regardless of `files`; stage them
# so the published tarball carries the Apache-2.0 licence and the readme.
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/LICENSE.md" "$STAGE/LICENSE.md"

echo "→ staged $(du -sh "$STAGE" | cut -f1) at $STAGE"
echo "→ running: pnpm pack $*"
cd "$STAGE"
pnpm pack "$@"

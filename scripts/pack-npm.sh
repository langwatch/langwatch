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
  # No ignore files in the staged tree. npm/pnpm pack honours a .gitignore
  # inside an included directory, and langwatch/.gitignore lists `/dist` and
  # `*.generated.ts` — both REQUIRED at runtime (the prebuilt vite client, and
  # the generated types the app imports). Carrying it into staging silently
  # strips them, the app tree arrives without dist/client, and first boot
  # falls back to a full on-runner `vite build`.
  #
  # This is exactly what the deleted langwatch/.npmignore existed to prevent:
  # an .npmignore overrides the sibling .gitignore, which is why the old file
  # had to restate the broad excludes explicitly. Staging replaces that
  # mechanism — the copy below IS the allowlist, so no ignore file should get
  # a second say over it.
  --exclude=.gitignore
  --exclude=.npmignore
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

# Assert the tarball still carries what the staging tree put in it.
#
# Packing applies its own filtering on top of the staged allowlist, so a file
# can be staged correctly and still not ship — which is how the prebuilt vite
# client went missing once already (a .gitignore inside langwatch/ listing
# `/dist`). The failure surfaces ~25 minutes later as an end-user boot that
# silently rebuilds and times out, so check it here where the cause is
# obvious. Only asserted when the source actually had a build to ship: a
# dev-checkout pack with no dist/ is legitimate.
# `|| true` on both: under `set -e` + `pipefail` a glob that matches nothing
# makes ls fail, which would abort the script here — silently, since packing
# has already succeeded by this point.
dest="$STAGE"
prev=""
for arg in "$@"; do
  [ "$prev" = "--pack-destination" ] && dest="$arg"
  prev="$arg"
done
tarball="$(ls -t "$dest"/*.tgz 2>/dev/null | head -n1 || true)"
[ -n "$tarball" ] || tarball="$(ls -t "$STAGE"/*.tgz 2>/dev/null | head -n1 || true)"

if [ -z "$tarball" ]; then
  echo "✗ pack produced no tarball in $dest" >&2
  exit 1
fi

if [ -f "$ROOT/langwatch/dist/client/index.html" ]; then
  # List once into a file rather than piping into `grep -q`. grep -q exits at
  # the first match, which SIGPIPEs tar; under `pipefail` that non-zero tar
  # fails the pipeline even though the match succeeded, so the check reported
  # the file missing when it was present. It fired on linux and not macos —
  # the race depends on how much tar writes before grep exits, which is
  # exactly the kind of check that must not be timing-dependent.
  listing="$(mktemp)"
  tar -tzf "$tarball" > "$listing"
  if ! grep -qx "package/app/langwatch/dist/client/index.html" "$listing"; then
    rm -f "$listing"
    echo "✗ the repo has a built langwatch/dist/client but the tarball does not ship it." >&2
    echo "  Something filtered it out after staging — check for an ignore file in the staged tree." >&2
    exit 1
  fi
  rm -f "$listing"
  echo "→ verified: tarball ships the prebuilt langwatch/dist/client"
fi

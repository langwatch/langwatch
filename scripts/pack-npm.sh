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
  # NOT `--exclude=reports`. rsync matches a bare name at ANY depth, and the
  # app has two real source directories called that —
  # langwatch/src/server/app-layer/reports (imported by presets.ts) and
  # langwatch/src/components/analytics/reports. Excluding the name dropped
  # both, and the published server died at first boot with
  #   Cannot find module './reports/report-chart.service'
  # inside the ClickHouse migration, ~20 minutes in. The pattern was carried
  # over from langwatch/.npmignore, where it was meant for the GDPR report
  # output directory at langwatch/reports — a runtime artifact that a clean
  # checkout does not even have.
  #
  # Every remaining bare name here was checked against the shipped trees for
  # the same collision: `test`/`tests` match only genuine test directories,
  # and `notebooks`/`coverage` match nothing in source.
  --exclude=Dockerfile*
  --exclude=.dockerignore
  --exclude=.github
  --exclude=*.map
  --exclude=*.tsbuildinfo
  --exclude=.DS_Store
  --exclude=.vscode
  --exclude=.idea
  # EVERY dotenv variant, not just `.env` and `*.local`. This tarball is
  # PUBLIC, and the working tree carries dotenv files that are gitignored but
  # very much present: haven writes langwatch/.env.portless (mode 0600, with
  # the admin password and access tokens in it) and the quickstart picker
  # writes langwatch/.env.dev-up. Listing the variants individually shipped
  # .env.portless into a real tarball — deleting langwatch/.npmignore removed
  # the `.env*.local` rule that used to catch some of them, and because this
  # script also strips .gitignore/.npmignore from the staged tree, this array
  # is the ONLY filter left. `.env.example` is tracked documentation and is
  # re-included after.
  # The include MUST precede the excludes: rsync takes the first matching
  # filter rule, so `.env.example` has to be claimed before `.env.*` sees it.
  --include=.env.example
  --exclude=.env
  --exclude=.env.*
  # Keys and certificates. `*.pem` was in the deleted langwatch/.npmignore and
  # was not carried across; a TLS key, JWT signing key or SSH key dropped
  # anywhere under a shipped directory would otherwise be published.
  --exclude=*.pem
  --exclude=*.key
  --exclude=*.p12
  --exclude=*.pfx
  # npm strips a root .npmrc from published packages, but ONLY at the root —
  # and this script deliberately stages everything one level down, which
  # disables that protection for every nested one. .npmrc is where
  # `npm config set --location=project` and most CI setups write registry auth.
  --exclude=.npmrc
  # Debug logs routinely carry registry URLs and, on auth failure, token
  # fragments.
  --exclude=*-debug.log*
  --exclude=.vercel
  --exclude=.next
  --exclude=.turbo
  --exclude=.pnpm-store
  # The quickwit dev binary (langwatch/quickwit*) is a local download, not
  # source — no tracked path anywhere contains the name (the old .npmignore's
  # `!elastic/quickwit` re-include referenced a directory that no longer
  # exists), so the bare-name exclude collides with nothing.
  --exclude=quickwit
  --exclude=quickwit-*
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
# Always pack to an explicit destination OUTSIDE the staging dir, because the
# EXIT trap deletes that dir. Packing from the repo root used to leave the
# tarball in the repo; staging moved the cwd, so a caller who passes no
# --pack-destination (both documented local entry points — `pnpm pack:npm` and
# `pnpm release:dry-run`) would have had it written into $STAGE and swept away
# on exit, producing nothing and reporting success.
#
# A caller-supplied destination still wins; this only supplies the default.
# Both spellings are handled, since `--pack-destination=DIR` would otherwise
# slip past a space-separated scan.
case " $* " in
  *" --pack-destination "*|*" --pack-destination="*|*=--pack-destination*)
    pnpm pack "$@"
    ;;
  *)
    pnpm pack --pack-destination "$ROOT" "$@"
    ;;
esac

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
# Default matches the default supplied to `pnpm pack` above. Both spellings of
# the flag are read, so `--pack-destination=DIR` cannot leave dest pointing at
# the wrong directory and produce a misleading "pack produced no tarball".
dest="$ROOT"
prev=""
for arg in "$@"; do
  [ "$prev" = "--pack-destination" ] && dest="$arg"
  case "$arg" in --pack-destination=*) dest="${arg#--pack-destination=}" ;; esac
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

# Assert no application source went missing.
#
# Two separate exclusion bugs in this script have already shipped a tarball
# that looked fine and died at first boot ~20 minutes in: a .gitignore in the
# staged tree stripping dist/, and an rsync `--exclude=reports` matching the
# name at any depth and taking src/server/app-layer/reports with it. Both were
# invisible until the smoke job ran the whole stack. Comparing what git tracks
# against what the tarball carries costs a second and catches the entire class.
#
# Only when packing from a git checkout — a published tree has no index.
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  in_tar="$(mktemp)"
  tracked="$(mktemp)"
  tar -tzf "$tarball" | sed 's|^package/app/||' | sort > "$in_tar"
  # Every shipped SOURCE tree, not just the app's: a bare name in EXCLUDES
  # matches at any depth in all of them, and the guard being complete for the
  # others was previously true only by accident (none happened to contain a
  # dir named like an exclude). Runtime source only: tests, fixtures and the
  # secret-shaped names the excludes above deliberately strip are filtered.
  # -c core.quotePath=false: git quotes non-ASCII paths by default, which
  # would never match the tar listing and read as missing source. The
  # `|| true` keeps a fully-filtered grep (exit 1) from aborting the script
  # under pipefail after the pack already succeeded.
  git -C "$ROOT" -c core.quotePath=false ls-files \
      langwatch/src langwatch/ee \
      mcp-server/src \
      packages/handled-error/src packages/langy/src \
      skills scripts \
    | { grep -vE '__tests__|\.test\.|\.spec\.|(^|/)tests?/|(^|/)\.npmrc$|\.env\.example$' || true; } | sort > "$tracked"
  missing="$(comm -23 "$tracked" "$in_tar")"
  rm -f "$in_tar" "$tracked"
  if [ -n "$missing" ]; then
    echo "✗ the tarball is missing application source the repo tracks:" >&2
    printf '%s\n' "$missing" | head -20 >&2 || true
    echo "  An exclude pattern in this script is too broad — a bare name in" >&2
    echo "  EXCLUDES matches at every depth, not just where it was meant." >&2
    exit 1
  fi
  echo "→ verified: tarball ships every tracked source file across the shipped trees"
fi

# The lockfile is the whole reason for the staged layout (npm strips one at
# the package ROOT), so its presence is asserted on every pack — not only in
# the smoke workflow.
if ! tar -tzf "$tarball" | grep -qx "package/app/pnpm-lock.yaml"; then
  echo "✗ the tarball ships no lockfile — the end-user install would not be reproducible." >&2
  exit 1
fi
echo "→ verified: tarball ships the workspace lockfile at app/pnpm-lock.yaml"

# Refuse to publish anything secret-shaped.
#
# The exclude list above is a blocklist, and a blocklist is one new filename
# away from being wrong — which already happened: `.env.portless` (haven's
# resolved config, mode 0600, admin password and access tokens inside) shipped
# into a real tarball because the list named `.env`, `.env.local` and
# `.env.*.local` individually. This tarball goes to a PUBLIC registry, so the
# check is fail-closed and runs on the packed artifact rather than on
# intentions.
secrets="$(mktemp)"
tar -tzf "$tarball" \
  | grep -Ei '(^|/)\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|(^|/)\.npmrc$|(^|/)id_(rsa|ed25519)|-debug\.log|(^|/)auth\.json$' \
  | grep -v '\.env\.example$' > "$secrets" || true
if [ -s "$secrets" ]; then
  echo "✗ the tarball contains secret-shaped files — refusing to publish:" >&2
  head -20 "$secrets" >&2
  rm -f "$secrets"
  exit 1
fi
rm -f "$secrets"
echo "→ verified: tarball carries no dotenv, key, .npmrc or debug-log files"

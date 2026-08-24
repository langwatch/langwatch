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
# `platform/app/package.json`, so nesting is transparent to it (see
# apps/server/src/services/app-dir.ts).
#
# `apps/server/distribution-files.json` stays the single source of truth for
# WHAT ships; this script only decides WHERE it lands.
# ---------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# `--check-filters` stages the tree, runs the source-completeness guard, and
# stops. No build output is needed and no tarball is produced, so it runs in
# seconds on every pull request instead of only inside the npx smoke matrix.
# The expensive half is skipped: packing, and the staged-versus-tarball guard
# that needs a tarball.
#
# `--stage-to DIR` stages into DIR and leaves it there. The filters decide what
# every npm user receives and their verdict is otherwise only visible in a
# temporary directory this script deletes on the way out, so this is how a
# person, or a test, reads what actually survived.
CHECK_FILTERS_ONLY=0
STAGE_TO=""
STAGE_TO_GIVEN=0
PACK_ARGS=()
prev_arg=""
for arg in "$@"; do
  if [ "$prev_arg" = "--stage-to" ]; then
    STAGE_TO="$arg"
    prev_arg=""
    continue
  fi
  case "$arg" in
    --check-filters) CHECK_FILTERS_ONLY=1 ;;
    --stage-to) prev_arg="--stage-to"; STAGE_TO_GIVEN=1 ;;
    --stage-to=*) STAGE_TO="${arg#--stage-to=}"; STAGE_TO_GIVEN=1 ;;
    *) PACK_ARGS+=("$arg") ;;
  esac
done
# Tracked separately from the value, so `--stage-to=` and `--stage-to ""` are
# refused rather than falling back to the temporary directory and quietly
# ignoring the mode the caller asked for.
if [ "$STAGE_TO_GIVEN" -eq 1 ] && [ -z "$STAGE_TO" ]; then
  echo "✗ --stage-to needs a directory" >&2
  exit 1
fi
set -- ${PACK_ARGS[@]+"${PACK_ARGS[@]}"}

# The CLI bundle is the package's entrypoint; packing without it produces a
# tarball whose `bin` dangles and which fails at `npx` time, not at pack time.
if [ "$CHECK_FILTERS_ONLY" -eq 0 ] && [ ! -f "apps/server/dist/cli.cjs" ]; then
  echo "✗ apps/server/dist/cli.cjs missing — run 'pnpm build:cli' first" >&2
  exit 1
fi
if [ ! -f "pnpm-lock.yaml" ]; then
  echo "✗ pnpm-lock.yaml missing — the artifact must ship a lockfile" >&2
  exit 1
fi

if [ -n "$STAGE_TO" ]; then
  # An empty directory only. `rsync -a` adds and overwrites but never deletes,
  # so anything already sitting there would read as staged and, on a full pack,
  # ship: the published manifest lists `app`, so the whole preserved tree goes
  # out. Refusing is the safe half of the choice, because the alternative is
  # this script deleting a directory a caller named.
  mkdir -p "$STAGE_TO"
  if [ -n "$(ls -A "$STAGE_TO" 2>/dev/null)" ]; then
    echo "✗ --stage-to needs an empty directory, and $STAGE_TO is not empty" >&2
    exit 1
  fi
  STAGE="$(cd "$STAGE_TO" && pwd)"
else
  STAGE="$(mktemp -d "${TMPDIR:-/tmp}/langwatch-pack.XXXXXX")"
  trap 'rm -rf "$STAGE"' EXIT
fi
APP="$STAGE/app"
mkdir -p "$APP"

# Trimming that used to live in the two .npmignore files. Stated once, here,
# where it is visible next to the copy that applies it.
#
# Everything in this array is matched by rsync at EVERY depth of every shipped
# tree, so a name only belongs here when that is what it means. A path that
# names one location goes in ANCHORED_EXCLUDES below instead.
EXCLUDES=(
  --exclude=node_modules
  # No ignore files in the staged tree. npm/pnpm pack honours a .gitignore
  # inside an included directory, and platform/app/.gitignore lists `/dist` and
  # `*.generated.ts` — both REQUIRED at runtime (the prebuilt vite client, and
  # the generated types the app imports). Carrying it into staging silently
  # strips them, the app tree arrives without dist/client, and first boot
  # falls back to a full on-runner `vite build`.
  #
  # This is exactly what the deleted platform/app/.npmignore existed to prevent:
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
  # platform/app/src/server/app-layer/reports (imported by presets.ts) and
  # platform/app/src/components/analytics/reports. Excluding the name dropped
  # both, and the published server died at first boot with
  #   Cannot find module './reports/report-chart.service'
  # inside the ClickHouse migration, ~20 minutes in. The pattern was carried
  # over from platform/app/.npmignore, where it was meant for the GDPR report
  # output directory at platform/app/reports — a runtime artifact that a clean
  # checkout does not even have.
  #
  # Every remaining bare name here was checked against the shipped trees for
  # the same collision: `test`, `tests` and `notebooks` match only genuine
  # test and notebook directories (`notebooks` drops services/langevals/
  # notebooks, which is what it is for), and `coverage` matches nothing.
  #
  # `Dockerfile` and `Dockerfile.<target>` rather than `Dockerfile*`: the star
  # form also matches any source file whose name merely starts with the word,
  # and every container file in the repo uses one of these two spellings.
  --exclude=Dockerfile
  --exclude=Dockerfile.*
  --exclude=.dockerignore
  --exclude=.github
  # The server bundles' source maps, re-included ahead of the blanket *.map
  # exclude below (rsync takes the FIRST matching rule). start:app and
  # start:workers run node with --enable-source-maps, so without these every
  # production stack trace an end user reports is a bundle offset instead of a
  # real file and line. They are safe to publish: the bundles are built with
  # sourcesContent:false, so a map carries path and position data only, never
  # source text. ~15 MB total, against a 300 MB tarball ceiling.
  # A new dist/server bundle needs its map listed here too.
  --include=server.cjs.map
  --include=workers.cjs.map
  --include=task.cjs.map
  --include=scenario-child-process.cjs.map
  --exclude=*.map
  --exclude=*.tsbuildinfo
  --exclude=.DS_Store
  --exclude=.vscode
  --exclude=.idea
  # Editor and merge leftovers. npm-packlist drops `*.orig`, `.*.swp` and
  # `._*` at every depth whatever the manifest says, so a working tree holding
  # one would stage a file the tarball then refuses, and the staged-versus-
  # tarball guard below would fail the pack.
  --exclude=*.orig
  --exclude=.*.swp
  --exclude=._*
  # EVERY dotenv variant, not just `.env` and `*.local`. This tarball is
  # PUBLIC, and the working tree carries dotenv files that are gitignored but
  # very much present: haven writes .env.portless (mode 0600, with
  # the admin password and access tokens in it) and the quickstart picker
  # writes .env.dev-up. Listing the variants individually shipped
  # .env.portless into a real tarball — deleting platform/app/.npmignore removed
  # the `.env*.local` rule that used to catch some of them, and because this
  # script also strips .gitignore/.npmignore from the staged tree, this array
  # is the ONLY filter left. `.env.example` is tracked documentation and is
  # re-included after.
  # The include MUST precede the excludes: rsync takes the first matching
  # filter rule, so `.env.example` has to be claimed before `.env.*` sees it.
  --include=.env.example
  --exclude=.env
  --exclude=.env.*
  # Keys and certificates. `*.pem` was in the deleted platform/app/.npmignore and
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
  # Logs. Debug logs routinely carry registry URLs and, on auth failure, token
  # fragments, and `pnpm dev:app` tees the whole dev server into server.log.
  # The tarball is public, so every log is stripped wherever it sits rather
  # than only the two filenames that were named here before. No tracked file
  # in any shipped tree ends in `.log`, and the guard below fails loudly if one
  # ever does.
  --exclude=*.log
  --exclude=*-debug.log*
  --exclude=.vercel
  --exclude=.next
  --exclude=.turbo
  --exclude=.pnpm-store
)

# Working-tree artifacts that live at ONE known path. Each is written from the
# repository root and is anchored there, so it cannot reach a file of the same
# name somewhere else.
#
# A bare name would have been shorter and is what these used to be, but rsync
# matches a bare name against every path component, so `--exclude=licenses.json`
# also silently drops a source data file of that name in any shipped tree, and
# `--exclude=quickwit` drops a source directory called that at any depth. The
# old .npmignore carried a `!elastic/quickwit` re-include, so such a directory
# has existed here before. That is the same class as the `--exclude=reports`
# failure recorded above, which reached npm and killed the published server at
# first boot.
ANCHORED_EXCLUDES=(
  # A local download, not source.
  platform/app/quickwit
  platform/app/quickwit-*
  platform/app/.sentryclirc
  # `pnpm licenses` writes this report.
  platform/app/licenses.json
  platform/app/prisma/db.sqlite*
  platform/app/e2e/auth.json
)

# Rewrite ANCHORED_EXCLUDES into rsync patterns for one `files` entry, into the
# global `anchored` array. rsync anchors a leading-slash pattern at the top of
# the transfer, and this script copies one entry at a time with the entry
# itself as that top, so `platform/app/licenses.json` becomes `/app/licenses.json`
# while the entry is `platform/app` and disappears entirely for every other
# entry.
anchored=()
anchored_patterns_for() {
  local entry="$1" path
  anchored=()
  for path in "${ANCHORED_EXCLUDES[@]}"; do
    case "$path" in
      "$entry"/*) anchored+=("--exclude=/${entry##*/}/${path#"$entry"/}") ;;
    esac
  done
}

# Everything the server-owned distribution manifest lists, copied into app/ so
# the workspace root sits one level below the package root.
#
# Trailing slashes are stripped before rsync sees the path: `rsync -a src/ dst/`
# copies the CONTENTS of src, `rsync -a src dst/` copies src itself. The `files`
# list writes directories both ways, and only the latter is wanted here — with
# the slash left on, apps/server/dist/ lands as app/apps/server/cli.cjs.
#
# A while-read loop rather than mapfile: mapfile is bash 4+, and macOS still
# ships bash 3.2, so a local `pnpm pack:npm` would die on it.
FILES_ENTRIES=()
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  entry="${entry%/}"
  FILES_ENTRIES+=("$entry")
  # npm skips a `files` entry that doesn't exist rather than failing, so this
  # matches it. Warn loudly though: a silently-skipped entry is how a stale
# list goes unnoticed (the old server launcher templates sat here for a long time
  # naming a directory that was never in the tree).
  if [ ! -e "$entry" ]; then
    echo "⚠ files entry does not exist, skipping: $entry" >&2
    continue
  fi
  mkdir -p "$APP/$(dirname "$entry")"
  anchored_patterns_for "$entry"
  rsync -a ${anchored[@]+"${anchored[@]}"} "${EXCLUDES[@]}" \
    "$ROOT/$entry" "$APP/$(dirname "$entry")/"
done < <(node -p "require('./apps/server/distribution-files.json').join('\n')")

# The workspace root's own manifest. pnpm resolves the lockfile's `.` importer
# against it, so `--frozen-lockfile` fails without it.
cp "$ROOT/package.json" "$APP/package.json"

# The published manifest is owned by apps/server. Its entrypoint and file list
# are adjusted only for the staged layout.
node -e '
  const fs = require("node:fs");
  const pkg = JSON.parse(fs.readFileSync("apps/server/package.json", "utf8"));
  pkg.bin = { "langwatch-server": "app/apps/server/dist/cli.cjs" };
  pkg.files = ["app"];
  delete pkg.scripts;
  fs.writeFileSync(process.argv[1], JSON.stringify(pkg, null, 2) + "\n");
' "$STAGE/package.json"

# npm auto-includes these at the package root regardless of `files`; stage them
# so the published tarball carries the Apache-2.0 licence and the readme.
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/LICENSE.md" "$STAGE/LICENSE.md"

# Guard: the staging filters must not drop application source.
#
# Two exclusion bugs in this script have already shipped a tarball that looked
# fine and died at first boot ~20 minutes in: a .gitignore in the staged tree
# stripping dist/, and an rsync `--exclude=reports` matching the name at any
# depth and taking src/server/app-layer/reports with it. Comparing what git
# tracks against what staging kept costs a second and catches the class.
#
# Across every tree `files` names, not a chosen subset of them. The subset this
# guard used to read was complete only while no over-broad pattern happened to
# land outside it, which is not a property anyone can maintain.
#
# Only when packing from a git checkout, because a published tree has no index.
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  # The file classes the filters above drop ON PURPOSE. Naming them here is
  # what keeps this guard a statement of intent rather than a second copy of
  # EXCLUDES: add a class only when shipping it would be wrong.
  #
  # Ignore files are on the list because an ignore file inside the package
  # gets a second say over what npm publishes, which is the whole reason the
  # staging tree strips them. Key material and dotenv files are on it because
  # the secrets check below refuses to publish them at all. The build-output
  # and editor directories are on it because nothing under them is source, even
  # on the day somebody commits one by accident.
  #
  # Tests, notebooks and containers.
  not_application_source='(^|/)(__tests__|tests?|notebooks)/'
  not_application_source="$not_application_source"'|(^|/)Dockerfile(\.|$)'
  # Ignore files, registry auth, dotenv and key material.
  not_application_source="$not_application_source"'|(^|/)\.(git|npm|docker)ignore$'
  not_application_source="$not_application_source"'|(^|/)\.npmrc$|(^|/)\.env($|\.)'
  not_application_source="$not_application_source"'|\.(pem|key|p12|pfx)$'
  # Build output, tool caches and editor state.
  not_application_source="$not_application_source"'|(^|/)(node_modules|coverage'
  not_application_source="$not_application_source"'|test-results|playwright-report|blob-report'
  not_application_source="$not_application_source"'|__pycache__|\.pytest_cache|\.venv'
  not_application_source="$not_application_source"'|\.github|\.vscode|\.idea'
  not_application_source="$not_application_source"'|\.next|\.turbo|\.vercel|\.pnpm-store)/'
  # The bundle source maps the filters re-include are build output, so no
  # tracked path can reach this rule and the re-include stays asserted by the
  # staged-versus-tarball guard after the pack.
  not_application_source="$not_application_source"'|\.(log|map|tsbuildinfo|orig|swp)$'
  not_application_source="$not_application_source"'|(^|/)(\.DS_Store|\._[^/]*)$'

  staged_list="$(mktemp)"
  all_tracked="$(mktemp)"
  tracked="$(mktemp)"
  (cd "$APP" && find . \( -type f -o -type l \)) | sed 's|^\./||' | sort > "$staged_list"
  # -c core.quotePath=false: git quotes non-ASCII paths by default, which would
  # never match the staged listing and would read as missing source.
  git -C "$ROOT" -c core.quotePath=false ls-files -- \
    ${FILES_ENTRIES[@]+"${FILES_ENTRIES[@]}"} | sort > "$all_tracked"
  # `|| true` on both: a grep that filters everything exits 1 and would abort
  # the script under `set -e`.
  { grep -vE "$not_application_source" "$all_tracked" || true; } > "$tracked"
  # `.env.example` is tracked documentation, and the filters re-include it ahead
  # of the dotenv excludes. The dotenv exemption above would otherwise stop this
  # guard from proving that ordering still holds, so put it back.
  { grep -E '(^|/)\.env\.example$' "$all_tracked" || true; } >> "$tracked"
  sort -u -o "$tracked" "$tracked"

  missing="$(comm -23 "$tracked" "$staged_list")"
  rm -f "$staged_list" "$all_tracked" "$tracked"
  if [ -n "$missing" ]; then
    echo "✗ staging dropped application source the repo tracks:" >&2
    printf '%s\n' "$missing" | head -20 >&2 || true
    echo "  Either an EXCLUDES pattern is broader than it means to be, since a" >&2
    echo "  bare name there matches at every depth, or these files are meant to" >&2
    echo "  stay out and belong in the exemptions right above this check." >&2
    exit 1
  fi
  echo "→ verified: staging keeps every tracked source file across the shipped trees"
fi

echo "→ staged $(du -sh "$STAGE" | cut -f1) at $STAGE"

if [ "$CHECK_FILTERS_ONLY" -eq 1 ]; then
  echo "→ --check-filters: staging verified, stopping before the pack"
  exit 0
fi

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

# Find the tarball that `pnpm pack` just wrote.
#
# `|| true` on both: under `set -e` + `pipefail` a glob that matches nothing
# makes ls fail, which would abort the script here, silently, since packing
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

# Assert the tarball carries everything the staging tree put in it.
#
# Packing applies its own filtering on top of the staged allowlist, so a file
# can be staged correctly and still not ship. That is how the prebuilt vite
# client went missing once already (a .gitignore inside the app listing
# `/dist`). The failure surfaces ~25 minutes later as an end-user boot that
# silently rebuilds and times out.
#
# Whatever survived staging IS the package, so this comparison needs no
# exemption list at all. That is what separates it from the guard before the
# pack: this one answers "did packing lose something", that one answers "did
# the filters keep the right things", and a single check that answered both
# reported a deliberate strip as a too-broad exclude pattern.
staged_all="$(mktemp)"
in_tar="$(mktemp)"
(cd "$STAGE" && find . \( -type f -o -type l \)) \
  | sed 's|^\./||' | grep -v '\.tgz$' | sort > "$staged_all"
# List once into a file rather than piping into `grep -q`. grep -q exits at the
# first match, which SIGPIPEs tar; under `pipefail` that non-zero tar fails the
# pipeline even though the match succeeded. It fires on linux and not macos,
# because the race depends on how much tar writes before grep exits.
tar -tzf "$tarball" | grep -v '/$' | sed 's|^package/||' | sort > "$in_tar"
lost="$(comm -23 "$staged_all" "$in_tar")"
rm -f "$staged_all" "$in_tar"
if [ -n "$lost" ]; then
  echo "✗ packing dropped files the staging tree carried:" >&2
  printf '%s\n' "$lost" | head -20 >&2 || true
  echo "  npm applies its own filtering on top of staging. Check for an ignore" >&2
  echo "  file that reached the staged tree, and for npm's own always-excluded" >&2
  echo "  names at the package root." >&2
  exit 1
fi
echo "→ verified: the tarball carries every staged file"

# The lockfile is the whole reason for the staged layout (npm strips one at
# the package ROOT), so its presence is asserted on every pack — not only in
# the smoke workflow.
#
# One listing, written to a file, shared with the secrets check below. NEVER
# `tar -tzf | grep -q` in this script: grep -q exits at the first match, tar
# takes SIGPIPE, GNU tar reports that as an error, and `set -o pipefail`
# fails the pipeline even though the match succeeded — bsdtar on macOS shrugs
# it off, so the failure is linux-only and looks like a missing file. This
# script has now shipped that bug twice; the dist guard above documents the
# first time.
full_listing="$(mktemp)"
tar -tzf "$tarball" > "$full_listing"
if ! grep -qx "package/app/pnpm-lock.yaml" "$full_listing"; then
  rm -f "$full_listing"
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
grep -Ei '(^|/)\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|(^|/)\.npmrc$|(^|/)id_(rsa|ed25519)|-debug\.log|(^|/)auth\.json$' "$full_listing" \
  | grep -v '\.env\.example$' > "$secrets" || true
rm -f "$full_listing"
if [ -s "$secrets" ]; then
  echo "✗ the tarball contains secret-shaped files — refusing to publish:" >&2
  head -20 "$secrets" >&2
  rm -f "$secrets"
  exit 1
fi
rm -f "$secrets"
echo "→ verified: tarball carries no dotenv, key, .npmrc or debug-log files"

#!/usr/bin/env bash
# Pathspec parity for detect-changes-by-sha.sh. On the real filters of every
# pull_request_target caller of .github/actions/detect-changes, the git
# `:(glob)` pathspecs must select exactly the changed paths dorny's picomatch
# (`{ dot: true }`) selects. Two samples: every tracked path plus look-alikes,
# and paths that sit beneath a literal pattern as if it were a directory.
#
# PICOMATCH names the module to compare against (dorny v4.0.1 pins ^2.3.1);
# the default is the workspace's copy, resolved from packages/test-harness.
#
# Spec: specs/ci/path-filters.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
BY_SHA="$SCRIPT_DIR/../detect-changes-by-sha.sh"
PICOMATCH="${PICOMATCH:-$(cd "$REPO_ROOT/packages/test-harness" && node -p 'require.resolve("picomatch")')}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false

PASS=0
FAIL=0

g() { git -c user.name=t -c user.email=t@example.com -c init.defaultBranch=main "$@"; }

# by_sha FUNCTION ARGS...: calls one function of the script under test.
by_sha() { bash -c 'source "$1"; shift; "$@"' _ "$BY_SHA" "$@"; }

# commit_paths REPO PATHS_FILE: an empty-tree base and a head adding every path.
commit_paths() {
  local repo="$1" empty blob
  g init -q "$repo"
  blob="$(g -C "$repo" hash-object -w --stdin </dev/null)"
  empty="$(g -C "$repo" commit-tree -m base "$(g -C "$repo" mktree </dev/null)")"
  while IFS= read -r path; do printf '100644 %s\t%s\n' "$blob" "$path"; done <"$2" |
    g -C "$repo" update-index --add --index-info
  BASE="$empty"
  HEAD="$(g -C "$repo" commit-tree -p "$empty" -m head "$(g -C "$repo" write-tree)")"
}

git_selects() {
  (cd "$1" && FILTERS="$2" MERGE_BASE="$BASE" HEAD_SHA="$HEAD" bash -c '
    source "$1"; PATTERNS="$(filter_patterns)"
    for key in $(filter_keys); do changed_paths "$key" | sed "s|^|$key	|"; done' _ "$BY_SHA") |
    LC_ALL=C sort
}

picomatch_selects() {
  node -e '
    const [picomatchPath, patternsFile, pathsFile] = process.argv.slice(1);
    const picomatch = require(picomatchPath);
    const fs = require("node:fs");
    const lines = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
    const byKey = new Map();
    for (const line of lines(patternsFile)) {
      const [key, pattern] = line.split("\t");
      byKey.set(key, [...(byKey.get(key) ?? []), picomatch(pattern, { dot: true })]);
    }
    const paths = lines(pathsFile);
    for (const [key, matchers] of byKey)
      for (const p of paths) if (matchers.some((m) => m(p))) console.log(`${key}\t${p}`);
  ' "$PICOMATCH" "$1" "$2" | LC_ALL=C sort
}

# compare LABEL FILTERS PATHS_FILE MIN_MATCHES
compare() {
  local label="$1" filters="$2" paths="$3" min="$4" repo patterns ours theirs
  repo="$WORK/$label"
  patterns="$repo.patterns"
  commit_paths "$repo" "$paths"
  FILTERS="$filters" by_sha filter_patterns >"$patterns"
  ours="$(git_selects "$repo" "$filters")"
  theirs="$(picomatch_selects "$patterns" "$paths")"
  if [ "$ours" = "$theirs" ] && [ "$(grep -c . <<<"$theirs" || true)" -ge "$min" ]; then
    echo "PASS: $label: git selects the same $(grep -c . <<<"$theirs" || true) paths as picomatch"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $label: git and picomatch disagree (< git, > picomatch)"
    diff <(printf '%s\n' "$ours") <(printf '%s\n' "$theirs") | head -20 || true
    FAIL=$((FAIL + 1))
  fi
}

# Look-alikes of the callers' patterns: nested, suffixed, prefixed, dotted, cased.
LOOK_ALIKES='apps/x/package.json
package.json.bak
.npmrc.bak
pnpm-lock.yaml~
uv.lock.d/x
sdks/gopher/a.go
sdks/go.mod
sdks/x/sdks/go/a.go
SDKS/GO/a.go
sdks/go/.hidden/deep/x.go
sdks/typescript-old/a.ts
mcp/typescriptx/a.ts
services/langevals/.hidden
services/langevals2/a.py
modules/model-provider/contract/src/catalog/model-catalog-extra.json
modules/model-provider/contract/src/catalog/sub/model-catalog.json
modules/model-provider/contract/src/catalog/.model-catalog.json
modules/model-provider/contract/src/catalog/model-catalog.json.bak
infra/docker/Dockerfile.langevals.bak
.github/actions/setup-pnpm-node/.x/y
.github/workflows/sdk-go-ci.yml.orig
packages/api/src/restx/a.ts
path with space/sdks/go/x'

# @scenario "Git pathspecs select the same changed paths as dorny's picomatch"
test_every_pull_request_target_caller() {
  local workflow name filters tracked="$WORK/tracked" under="$WORK/under"
  git -C "$REPO_ROOT" ls-files -z | tr '\0' '\n' | grep -v '[\"\\]' >"$tracked"
  printf '%s\n' "$LOOK_ALIKES" >>"$tracked"
  local callers=0
  for workflow in $(grep -l '^  pull_request_target:' "$REPO_ROOT"/.github/workflows/*.y*ml); do
    filters="$(by_sha filters_as_json <"$workflow" | jq -r '
      .jobs[].steps[]? | select(.uses == "./.github/actions/detect-changes") | .with.filters')"
    [ -n "$filters" ] || continue
    callers=$((callers + 1))
    name="$(basename "$workflow" | sed 's/\.ya*ml$//')"
    compare "$name-tracked" "$filters" "$tracked" 1
    FILTERS="$filters" by_sha filter_patterns | cut -f2 |
      sed -e '/\/\*\*$/{s|/\*\*$||;b' -e '}' -e '/[*?[]/d' -e 's|$|/inner|' | sort -u >"$under"
    compare "$name-beneath" "$filters" "$under" 0
  done
  if [ "$callers" -ge 5 ]; then
    echo "PASS: $callers pull_request_target callers compared"
    PASS=$((PASS + 1))
  else
    echo "FAIL: expected the five pull_request_target callers, found $callers"
    FAIL=$((FAIL + 1))
  fi
}

test_every_pull_request_target_caller

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1
exit 0

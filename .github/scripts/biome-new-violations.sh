#!/usr/bin/env bash
#
# Fail when a PR ADDS Biome violations, measured against a format-normalized
# merge base.
#
# WHY NOT reviewdog's `filter-mode=added`, which is the obvious answer.
#
# It attributes a diagnostic to a PR when the diagnostic's line is one the diff
# added. Biome anchors `noExcessiveCognitiveComplexity`,
# `noExcessiveLinesPerFunction` and `useMaxParams` at the function's DECLARATION
# line, so rewrapping a signature -- something the formatter does on its own,
# with no author involvement -- re-adds that line and hands the PR the whole
# function's pre-existing backlog. Measured on the branch that introduced these
# rules: 61 findings, of which the author had written none. A gate that reports
# things the author did not do gets switched off, which is the same end state as
# the green-but-meaningless check this whole ruleset exists to remove.
#
# So ask the question that actually matters -- "does this PR leave the tree
# worse than it found it?" -- by counting violations per (file, rule) on both
# sides and failing only on an increase.
#
# The base is FORMATTED FIRST, with the head's own config. Without that step the
# comparison is not like-for-like for a rule that counts lines: a 58-line
# function whose signature the formatter rewraps onto four lines becomes a
# 61-line function and trips a 60-line limit that nobody's edit went near. On
# the branch that introduced these rules, normalizing the base collapsed 77
# apparent regressions to 1 -- and that 1 was real.
#
# A moved or renamed file is followed: `git diff --find-renames` supplies the
# old path, and the base counts recorded there are compared at the new path.
# Moving a file therefore reports nothing, while moving a file AND growing one
# of its counts still fails.
#
# KNOWN AND ACCEPTED: net-zero churn within one file and rule (delete one long
# function, add another) passes. reviewdog still annotates every added line in
# the job above, so those stay visible on the diff; they are not gated, which
# is the deliberate trade for not gating the false positives.
#
# Usage: biome-new-violations.sh <head-rdjson> <base-ref> <path>...
#   <head-rdjson>  biome --reporter=rdjson output for HEAD, paths relative to
#                  the app directory (i.e. BEFORE any repo-root prefixing)
#   <base-ref>     e.g. origin/main
#   <path>...      the same paths the head run was given

set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <head-rdjson> <base-ref> <path>..." >&2
  exit 2
fi

HEAD_RDJSON="$1"
BASE_REF="$2"
shift 2
PATHS=("$@")

REPO_ROOT="$(git rev-parse --show-toplevel)"

# The app directory, resolved per tree rather than hardcoded. PATHS are relative
# to it, and the base tree is a checkout of the merge base -- which, across the
# commit that moved langwatch/ to platform/app/, is laid out the OLD way. A
# hardcoded path makes the base lint produce nothing, and the guard below then
# exits 2 on a tree that is perfectly fine.
app_dir() {
  if [ -f "$1/platform/app/package.json" ]; then echo "platform/app"; else echo "langwatch"; fi
}
HEAD_APP="$(app_dir "$REPO_ROOT")"

BIOME="$REPO_ROOT/$HEAD_APP/node_modules/.bin/biome"

if [ ! -x "$BIOME" ]; then
  echo "biome not found at $BIOME -- run pnpm install at the repo root first (single workspace, ADR-076)" >&2
  exit 2
fi

MERGE_BASE="$(git merge-base "$BASE_REF" HEAD)"
echo "comparing against merge base $MERGE_BASE ($BASE_REF)"

BASE_TREE="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$BASE_TREE" >/dev/null 2>&1 || true
  rm -rf "$BASE_TREE"
}
trap cleanup EXIT

# --detach: this is a throwaway checkout, never a branch anyone commits to.
# --quiet: the per-file checkout progress is thousands of lines of CI log.
git worktree add --quiet --detach "$BASE_TREE" "$MERGE_BASE"

# The base is linted under the HEAD's rules, not its own. The question is "what
# did main already have, judged by the rules we are adopting" -- judging it by
# main's rules would count a newly-enabled rule's entire backlog as this PR's.
BASE_APP="$(app_dir "$BASE_TREE")"

rm -f "$BASE_TREE/$BASE_APP"/biome.json "$BASE_TREE/$BASE_APP"/biome.jsonc
cp "$REPO_ROOT/$HEAD_APP/biome.jsonc" "$BASE_TREE/$BASE_APP/biome.jsonc"

# The head config's `plugins` entries are paths relative to it, so the analyzer
# plugins have to travel with it. A PR that ADDS a plugin names a .grit file the
# base tree does not have; biome then fails to load the config outright, writes
# no rdjson, and the guard below reports "could not lint the merge base" for a
# tree that is perfectly fine. Same reasoning as the config copy above and the
# node_modules symlink below: both sides must resolve identically.
if [ -d "$REPO_ROOT/$HEAD_APP/biome-plugins" ]; then
  rm -rf "$BASE_TREE/$BASE_APP/biome-plugins"
  cp -R "$REPO_ROOT/$HEAD_APP/biome-plugins" "$BASE_TREE/$BASE_APP/biome-plugins"
fi

# The app config is a NESTED config (`"root": false`, `"extends": "//"`), so the
# repo-root config has to come across with it. A nested config whose root is
# missing does not fail -- Biome silently falls back to its built-in defaults,
# which turns every disabled rule back on and reformats to the default style.
# On the subset used to verify this, that is 179 diagnostics becoming 1232, all
# of them counted as new. Copy the root, and only from HEAD, for the same reason
# the app config is copied from HEAD: the base is judged by the rules we are
# adopting. A merge base from before the root config existed has none to remove.
if [ ! -f "$REPO_ROOT/biome.jsonc" ]; then
  echo "::error::no biome.jsonc at the repo root -- $HEAD_APP/biome.jsonc is nested and falls back to Biome's defaults without it, which reports the tree's whole backlog as new" >&2
  exit 2
fi

rm -f "$BASE_TREE"/biome.json "$BASE_TREE"/biome.jsonc
cp "$REPO_ROOT/biome.jsonc" "$BASE_TREE/biome.jsonc"

# Both sides must resolve the same dependencies or the type-aware rules
# (noFloatingPromises, noMisusedPromises) disagree for reasons that have nothing
# to do with the diff. Symlinking is enough -- biome only reads them.
ln -sfn "$REPO_ROOT/$HEAD_APP/node_modules" "$BASE_TREE/$BASE_APP/node_modules"
if [ -d "$REPO_ROOT/node_modules" ]; then
  ln -sfn "$REPO_ROOT/node_modules" "$BASE_TREE/node_modules"
fi

# Normalize the base's formatting. --linter-enabled=false so this only rewrites
# layout: it must not fix a lint violation, or the base would look better than
# it is and the PR would inherit the difference as a regression.
(cd "$BASE_TREE/$BASE_APP" && "$BIOME" check --write --linter-enabled=false "${PATHS[@]}" >/dev/null 2>&1) || true

BASE_RDJSON="$BASE_TREE/base.rdjson"
# Biome exits non-zero whenever it reports anything, which is the normal case.
(cd "$BASE_TREE/$BASE_APP" && "$BIOME" check --reporter=rdjson "${PATHS[@]}" > "$BASE_RDJSON" 2>/dev/null) || true

# An unreadable or empty base would make every head diagnostic look new. That
# fails loudly rather than quietly, but the message would be nonsense, so say
# what actually went wrong.
if ! jq -e '.diagnostics | type == "array"' "$BASE_RDJSON" >/dev/null 2>&1; then
  echo "::error::could not lint the merge base -- no usable rdjson at $BASE_RDJSON" >&2
  exit 2
fi

counts() {
  jq '[.diagnostics[] | (.location.path + "|" + (.code.value // "?"))]
      | group_by(.) | map({key: .[0], value: length}) | from_entries' "$1"
}

BASE_COUNTS="$BASE_TREE/base.counts.json"
HEAD_COUNTS="$BASE_TREE/head.counts.json"
counts "$BASE_RDJSON" > "$BASE_COUNTS"
counts "$HEAD_RDJSON" > "$HEAD_COUNTS"

# A moved file has no base counts under its new path, so its whole
# pre-existing backlog reads as this PR's work. Follow the move: read the
# base counts under the OLD path and compare them at the NEW one. A move
# with unchanged counts then reports nothing, and a move that also grew a
# count still fails. Both sides are made app-relative, because the two
# trees can hold the app at different paths.
RENAMES_TSV="$BASE_TREE/renames.tsv"
git diff --name-status --find-renames=50% "$MERGE_BASE" HEAD |
  awk -F'\t' -v base_app="$BASE_APP/" -v head_app="$HEAD_APP/" '
    $1 ~ /^R/ && index($2, base_app) == 1 && index($3, head_app) == 1 {
      print substr($2, length(base_app) + 1) "\t" substr($3, length(head_app) + 1)
    }
  ' > "$RENAMES_TSV"
echo "renames followed: $(wc -l < "$RENAMES_TSV" | tr -d ' ')"

BASE_COUNTS_AT_HEAD_PATHS="$BASE_TREE/base.counts.remapped.json"
jq -R -s --slurpfile b "$BASE_COUNTS" '
  ($b[0]) as $B |
  ( split("\n") | map(select(length > 0) | split("\t"))
    | map({ key: .[0], value: .[1] }) | from_entries ) as $RENAMED |
  reduce ($B | to_entries[]) as $entry ({};
    ($entry.key | split("|")) as $parts |
    (($RENAMED[$parts[0]] // $parts[0]) + "|" + $parts[1]) as $key |
    .[$key] = ((.[$key] // 0) + $entry.value)
  )
' "$RENAMES_TSV" > "$BASE_COUNTS_AT_HEAD_PATHS"

echo "base diagnostics: $(jq '.diagnostics | length' "$BASE_RDJSON")"
echo "head diagnostics: $(jq '.diagnostics | length' "$HEAD_RDJSON")"

REGRESSIONS="$BASE_TREE/regressions.json"
jq -n --slurpfile h "$HEAD_COUNTS" --slurpfile b "$BASE_COUNTS_AT_HEAD_PATHS" '
  ($h[0]) as $H | ($b[0]) as $B |
  [ $H | to_entries[]
    | select(.value > ($B[.key] // 0))
    | { file: (.key | split("|")[0]),
        rule: (.key | split("|")[1]),
        base: ($B[.key] // 0),
        head: .value } ]
  | sort_by(.file, .rule)
' > "$REGRESSIONS"

NEW_TOTAL="$(jq '[.[] | .head - .base] | add // 0' "$REGRESSIONS")"
FIXED_TOTAL="$(jq -n --slurpfile h "$HEAD_COUNTS" --slurpfile b "$BASE_COUNTS_AT_HEAD_PATHS" '
  ($h[0]) as $H | ($b[0]) as $B |
  [ $B | to_entries[] | select(.value > ($H[.key] // 0)) | .value - ($H[.key] // 0) ] | add // 0
')"

echo "violations removed by this PR: $FIXED_TOTAL"

if [ "$NEW_TOTAL" -eq 0 ]; then
  echo "no new Biome violations"
  exit 0
fi

echo
echo "This PR adds $NEW_TOTAL Biome violation(s):"
echo
jq -r '.[] | "  \(.file)\n    \(.rule): \(.base) -> \(.head)"' "$REGRESSIONS"
echo
echo "Each is a rule the repo already enforces on new code. Either fix it, or"
echo "-- if the rule is genuinely wrong for this code -- scope an override in"
echo "platform/app/biome.jsonc with a comment saying why."

# Also surface it on the run summary, so the reason is visible without opening
# the log.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Biome: $NEW_TOTAL new violation(s)"
    echo
    echo "| File | Rule | Base | Head |"
    echo "| --- | --- | --- | --- |"
    jq -r '.[] | "| `\(.file)` | \(.rule) | \(.base) | \(.head) |"' "$REGRESSIONS"
  } >> "$GITHUB_STEP_SUMMARY"
fi

exit 1

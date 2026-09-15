#!/usr/bin/env bash
# Unit test for check-added-images.sh
#
# Builds a throwaway git repository whose HEAD adds files, then runs the guard
# against the base commit. The guard's whole behaviour is its path allowlist, so
# that is what this pins: an image in an allowed home passes, and one outside
# every allowed home fails naming the file. Without this, the allowlist is only
# exercised by whatever a given PR happens to add, and dropping a prefix from it
# breaks nothing that CI would notice.
#
# Spec: specs/ci/no-committed-screenshots.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GATE="$SCRIPTS_DIR/check-added-images.sh"

PASS=0
FAIL=0

record() {
  local ok="$1"
  local description="$2"
  if [ "$ok" = "yes" ]; then
    echo "PASS: $description"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $description"
    echo "----- gate output -----"
    echo "$LAST_OUTPUT"
    echo "-----------------------"
    FAIL=$((FAIL + 1))
  fi
}

REPOS=()
cleanup() {
  local repo
  for repo in ${REPOS+"${REPOS[@]}"}; do
    rm -rf "$repo"
  done
}
trap cleanup EXIT

# Runs the gate over a repository whose HEAD adds the named paths. Sets
# LAST_OUTPUT to the combined output and returns the gate's exit code.
#
# A text file is added alongside so the head commit is never empty, and so the
# no-images case still has a diff to judge.
run_gate() {
  local repo
  repo="$(mktemp -d)"
  REPOS+=("$repo")

  git -C "$repo" init --quiet -b main
  git -C "$repo" config user.email "ci@example.com"
  git -C "$repo" config user.name "CI"
  echo "base" > "$repo/base.txt"
  git -C "$repo" add -A
  git -C "$repo" commit --quiet -m "base"

  local base
  base="$(git -C "$repo" rev-parse HEAD)"

  echo "note" > "$repo/notes.txt"
  local file
  for file in "$@"; do
    mkdir -p "$repo/$(dirname "$file")"
    printf 'not really an image' > "$repo/$file"
  done
  git -C "$repo" add -A
  git -C "$repo" commit --quiet -m "add files"

  local exit_code=0
  LAST_OUTPUT="$(cd "$repo" && bash "$GATE" "$base" 2>&1)" || exit_code=$?
  return "$exit_code"
}

assert_gate_passes() {
  local description="$1"
  shift
  if run_gate "$@"; then
    record yes "$description"
  else
    record no "$description"
  fi
}

assert_gate_fails() {
  local description="$1"
  shift
  if run_gate "$@"; then
    record no "$description, but the gate passed"
  else
    record yes "$description"
  fi
}

assert_output_contains() {
  local needle="$1" description="$2"
  if printf '%s' "$LAST_OUTPUT" | grep -qF "$needle"; then
    record yes "$description"
  else
    record no "$description, no '$needle' in the output"
  fi
}

# @scenario "A PR that adds no images passes"
test_a_pr_that_adds_no_images_passes() {
  assert_gate_passes "a PR that adds no images exits 0"
}

# @scenario "A docs image in an allowed location passes"
test_a_docs_image_in_an_allowed_location_passes() {
  assert_gate_passes "a docs image under docs/images exits 0" \
    docs/images/trace-view.png
}

# @scenario "README cover art passes"
#
# The images the README renders live beside the HTML they are rendered from,
# so the allowlist has to name that directory.
test_readme_cover_art_passes() {
  assert_gate_passes "README cover art under .github/readme exits 0" \
    .github/readme/cover.jpg .github/readme/backdrop.jpg
}

# @scenario "A screenshot committed to the app tree fails"
test_a_screenshot_committed_to_the_app_tree_fails() {
  assert_gate_fails "a screenshot in the app tree exits non-zero" \
    platform/app/.pr-screenshots/before.png
  assert_output_contains "platform/app/.pr-screenshots/before.png" \
    "the failure names the offending file"
  assert_output_contains "pr-screenshots" \
    "the failure points at the pr-screenshots repo"
}

# @scenario "A screenshot dumped into a docs subfolder fails"
#
# docs/images and docs/media are allowed homes; a sibling folder under docs is
# not, so the prefix match has to be a prefix rather than "somewhere under docs".
test_a_screenshot_dumped_into_a_docs_subfolder_fails() {
  assert_gate_fails "a screenshot in an unlisted docs subfolder exits non-zero" \
    docs/pairwise-bugfixes/one.png docs/pairwise-bugfixes/two.png
  assert_output_contains "adds 2 image" "both screenshots are counted"
}

# @scenario "An image at the repository root fails"
test_an_image_at_the_repository_root_fails() {
  assert_gate_fails "an image at the repository root exits non-zero" \
    screenshot.png
}

# One stray image decides the outcome even when the same PR adds an allowed
# one, and the count names only the stray.
test_one_stray_image_fails_a_pr_that_also_adds_an_allowed_one() {
  assert_gate_fails "a stray image alongside an allowed one exits non-zero" \
    .github/readme/cover.jpg tools/diagram.png
  assert_output_contains "adds 1 image" "only the stray image is counted"
  assert_output_contains "tools/diagram.png" "the failure names the stray image"
}

# The guard judges images, not every added file.
test_a_non_image_outside_every_allowed_location_passes() {
  assert_gate_passes "a non-image outside every allowed location exits 0" \
    tools/notes.md
}

test_a_pr_that_adds_no_images_passes
test_a_docs_image_in_an_allowed_location_passes
test_readme_cover_art_passes
test_a_screenshot_committed_to_the_app_tree_fails
test_a_screenshot_dumped_into_a_docs_subfolder_fails
test_an_image_at_the_repository_root_fails
test_one_stray_image_fails_a_pr_that_also_adds_an_allowed_one
test_a_non_image_outside_every_allowed_location_passes

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1
exit 0

#!/usr/bin/env bash
# Unit test for the path filters of publish-docker-ecr.yml
#
# Every image there builds with the repository root as its context, so
# .dockerignore decides what each build can see. A filter that omits it lets a
# .dockerignore change re-tag the previous image instead of rebuilding it.
#
# Spec: specs/ci/publish-ecr-images.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW="$SCRIPT_DIR/../../workflows/publish-docker-ecr.yml"

PASS=0
FAIL=0

# Prints "<filter> <pattern>" for each pattern of the paths-filter `filters:`
# block. Filter keys sit at 12 spaces, their patterns at 14.
patterns() {
  awk '
    /^ *filters: \|$/ { inside = 1; next }
    inside && /^ {0,10}[^ ]/ { inside = 0 }
    inside && /^ {12}[a-z0-9-]+:$/ { key = $1; sub(/:$/, "", key); print key " -"; next }
    inside && /^ {14}- / { pattern = $0; sub(/^ *- /, "", pattern); print key " " pattern }
  ' "$WORKFLOW"
}

filters="$(patterns | awk '{ print $1 }' | sort -u)"
if [ -z "$filters" ]; then
  echo "FAIL: no path filters found in $WORKFLOW"
  exit 1
fi

# The build contexts, checked rather than assumed.
if grep -E '^ *context: ' "$WORKFLOW" | grep -vqE 'context: \.$'; then
  echo "FAIL: a build context other than the repository root; revisit this test"
  exit 1
fi

# Read once: piping `patterns` into `grep -q` under pipefail would SIGPIPE awk
# whenever grep matched early, failing a valid filter.
ALL_PATTERNS="$(patterns)"

# @scenario "A .dockerignore change rebuilds every image"
test_every_filter_rebuilds_on_a_dockerignore_change() {
  local filter
  for filter in $filters; do
    if grep -qxF "$filter '.dockerignore'" <<<"$ALL_PATTERNS"; then
      echo "PASS: $filter rebuilds on a .dockerignore change"
      PASS=$((PASS + 1))
    else
      echo "FAIL: $filter rebuilds on a .dockerignore change"
      FAIL=$((FAIL + 1))
    fi
  done
}

# A wiring check, not a scenario binding: which tag nearest-ancestor-tag.sh
# picks is proved by nearest-ancestor-tag.test.sh and publish-lambda-tag.test.sh.
# This only pins that the service-image re-tag calls it, and that its output,
# not a mention in a comment, is what `previous` is set from.
test_service_images_are_retagged_from_the_nearest_ancestor() {
  if grep -vE '^[[:space:]]*#' "$WORKFLOW" \
      | grep -qE '\|[[:space:]]*HEAD_COMMIT="\$\{GITHUB_SHA\}"[[:space:]]+\.github/scripts/nearest-ancestor-tag\.sh\)$'; then
    echo "PASS: service images pick their previous tag with nearest-ancestor-tag.sh"
    PASS=$((PASS + 1))
  else
    echo "FAIL: service images pick their previous tag with nearest-ancestor-tag.sh"
    FAIL=$((FAIL + 1))
  fi
}

test_every_filter_rebuilds_on_a_dockerignore_change
test_service_images_are_retagged_from_the_nearest_ancestor

echo
echo "publish-docker-ecr.yml path filters: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]

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

# @scenario "A .dockerignore change rebuilds every image"
for filter in $filters; do
  if patterns | grep -qxF "$filter '.dockerignore'"; then
    echo "PASS: $filter rebuilds on a .dockerignore change"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $filter rebuilds on a .dockerignore change"
    FAIL=$((FAIL + 1))
  fi
done

echo
echo "publish-docker-ecr.yml path filters: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]

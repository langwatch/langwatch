#!/usr/bin/env bash
# Shape test for the two workflows that publish to the artifacts registry.
#
# Which registries a workflow reaches is written in its YAML, so the YAML is
# what this reads. Comment lines are ignored: a comment may name what the
# workflow refuses to do.
#
# Specs: specs/ci/publish-prerelease-charts-to-ecr.feature
#        specs/ci/publish-ecr-images.feature
#
# WORKFLOWS_DIR and CHARTS_DIR override the paths, so a copy can be broken.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOWS_DIR="${WORKFLOWS_DIR:-$SCRIPT_DIR/../../workflows}"
CHARTS_DIR="${CHARTS_DIR:-$SCRIPT_DIR/../../../charts}"
CHARTS_WORKFLOW="$WORKFLOWS_DIR/prerelease-charts-oci.yml"
IMAGES_WORKFLOW="$WORKFLOWS_DIR/publish-docker-ecr.yml"

PASS=0
FAIL=0

record() {
  if [ "$1" = yes ]; then
    echo "PASS: $2"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $2"
    FAIL=$((FAIL + 1))
  fi
}

# The workflow without its comment lines.
code() {
  grep -vE '^[[:space:]]*#' "$1"
}

# @scenario "No prerelease chart goes to a public registry"
test_the_chart_workflow_reaches_no_public_registry() {
  local body
  body="$(code "$CHARTS_WORKFLOW")"
  if grep -qiE 'ghcr\.io' <<<"$body"; then
    record no "the chart workflow names no ghcr.io"
  else
    record yes "the chart workflow names no ghcr.io"
  fi
  if grep -qE 'packages:[[:space:]]*write' <<<"$body"; then
    record no "the chart workflow holds no packages: write"
  else
    record yes "the chart workflow holds no packages: write"
  fi
}

# @scenario "The ECR copy is not signed"
test_the_chart_workflow_signs_nothing() {
  if code "$CHARTS_WORKFLOW" | grep -qiE 'cosign|sigstore'; then
    record no "the chart workflow runs no cosign"
  else
    record yes "the chart workflow runs no cosign"
  fi
}

# @scenario "A release publishes nothing to the artifacts registry"
test_the_image_workflow_runs_only_on_main() {
  # Top-level keys of the `on:` block sit at two spaces.
  if code "$IMAGES_WORKFLOW" \
      | awk '/^on:/ { inside = 1; next } inside && /^[^ ]/ { inside = 0 } inside && /^  release:/ { found = 1 } END { exit !found }'; then
    record no "the image workflow has no release trigger"
  else
    record yes "the image workflow has no release trigger"
  fi
  # `meta` is the first job; every other job needs it.
  if code "$IMAGES_WORKFLOW" \
      | awk '/^  meta:$/ { inside = 1; next } inside && /^  [a-z]/ { inside = 0 } inside && /^    if: github\.ref == .refs\/heads\/main.$/ { found = 1 } END { exit !found }'; then
    record yes "the first job runs only on refs/heads/main"
  else
    record no "the first job runs only on refs/heads/main"
  fi
}

# A wiring check, not a scenario binding: a chart missing from the list is
# packaged and never pushed, and nothing else would fail.
test_ecr_charts_lists_every_chart() {
  local listed present
  listed="$(code "$CHARTS_WORKFLOW" | sed -nE 's/^[[:space:]]*ECR_CHARTS:[[:space:]]*(.*)$/\1/p' | tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ')"
  present="$(for f in "$CHARTS_DIR"/*/Chart.yaml; do sed -nE 's/^name:[[:space:]]*(.*)$/\1/p' "$f"; done | sort | tr '\n' ' ')"
  if [ -n "$present" ] && [ "$listed" = "$present" ]; then
    record yes "ECR_CHARTS lists every chart with a Chart.yaml"
  else
    echo "  ECR_CHARTS: ${listed:-<none>}; charts: ${present:-<none>}"
    record no "ECR_CHARTS lists every chart with a Chart.yaml"
  fi
}

test_the_chart_workflow_reaches_no_public_registry
test_the_chart_workflow_signs_nothing
test_the_image_workflow_runs_only_on_main
test_ecr_charts_lists_every_chart

echo
echo "publish workflow shape: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]

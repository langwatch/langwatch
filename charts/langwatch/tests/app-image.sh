#!/usr/bin/env bash
# Prints the app image reference (<repo>:<tag>) parsed from the chart's default
# values. This is the single source for that pipeline: e2e.sh and the CI
# build-images step both call it, so the `helm show values` parse lives in one
# place and can never drift between the local run and the workflow.
#
# Usage: app-image.sh [chart-dir]   (chart-dir defaults to the current directory)
set -euo pipefail

chart_dir="${1:-.}"
values="$(helm show values "$chart_dir")"
repo="$(printf '%s\n' "$values" | grep -A20 '^images:' | grep -A2 '^  app:' | grep 'repository:' | awk '{print $2}')"
tag="$(printf '%s\n' "$values" | grep -A20 '^images:' | grep -A2 '^  app:' | grep 'tag:' | head -1 | awk '{print $2}')"
printf '%s:%s\n' "$repo" "$tag"

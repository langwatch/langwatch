#!/usr/bin/env bash
# Asserts the Keeper configuration the chart renders. Pure `helm template`
# and grep, no cluster required.
set -euo pipefail

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CHART_DIR"

fail() { echo "FAIL: $*" >&2; exit 1; }

# @scenario "The chart's Keeper writes snapshots that 25.10 reads"
test_snapshot_version_held() {
  local out
  out="$(helm template t . -f tests/values-replicated.yaml --show-only templates/configmap.yaml)"
  sed -n '/<coordination_settings>/,/<\/coordination_settings>/p' <<<"$out" \
    | grep -q '<write_snapshot_version>6</write_snapshot_version>' \
    || fail "Keeper must hold write_snapshot_version at 6 while 25.10 is a rollback target"
  echo "PASS: Keeper writes snapshot V6"
}

echo "--- keeper assertions ---"
test_snapshot_version_held

#!/usr/bin/env bash
#
# Renders the chart with and without the redis-valkey overlay and asserts that
# only the image changes: the same command and probes serve both servers, and
# the default install still runs Redis. See specs/setup/helm-redis-valkey.feature.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/redis-valkey.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1] $2"
  failures=$((failures + 1))
}

# Prints only the Redis StatefulSet, so another component can never satisfy an assertion.
render_redis() {
  # shellcheck disable=SC2086
  helm template lw . $1 | awk '
    /^# Source: langwatch\/templates\/redis\/statefulset\.yaml/ { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab { print }
  '
}

readonly DEFAULT="-f examples/overlays/size-prod.yaml --set autogen.enabled=true"
readonly VALKEY="$DEFAULT -f examples/overlays/redis-valkey.yaml"

image_of() {
  printf '%s' "$1" | awk '$1 == "image:" { gsub(/"/,"",$2); print $2 }' | head -n 1
}

# The server command and both probes, with the image line removed.
behaviour_of() {
  printf '%s' "$1" | grep -E 'command:|redis-cli|redis-server'
}

# @scenario "The overlay runs the chart-managed Redis as Valkey"
test_overlay_renders_valkey_image() {
  local image
  image=$(image_of "$(render_redis "$VALKEY")")
  if [ "$image" != "valkey/valkey:9.2" ]; then
    fail "valkey image" "image is '$image', expected valkey/valkey:9.2"
    return
  fi
  echo "ok   [valkey image] $image"
}

# @scenario "Valkey runs with the same command and probes as Redis"
test_command_and_probes_unchanged() {
  local with without
  with=$(behaviour_of "$(render_redis "$VALKEY")")
  without=$(behaviour_of "$(render_redis "$DEFAULT")")
  if [ -z "$with" ] || [ "$with" != "$without" ]; then
    fail "command and probes" "differ between the Valkey overlay and the default"
    return
  fi
  echo "ok   [command and probes] identical to the default"
}

# @scenario "Without the overlay the chart still runs Redis"
test_default_stays_redis() {
  local image
  image=$(image_of "$(render_redis "$DEFAULT")")
  if [ "$image" != "redis:8.0" ]; then
    fail "default image" "image is '$image', expected redis:8.0"
    return
  fi
  echo "ok   [default image] $image"
}

test_overlay_renders_valkey_image
test_command_and_probes_unchanged
test_default_stays_redis

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures redis valkey check(s) failed"
  exit 1
fi

echo
echo "all redis valkey checks pass"

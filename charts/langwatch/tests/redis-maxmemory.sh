#!/usr/bin/env bash
# Redis starts with --maxmemory at half of its memory limit (or the explicit
# override), so a snapshot's copied pages fit under the container limit.
# See specs/setup/helm-redis-memory-ceiling.feature.
#
# Scenario bindings use the same `@scenario` token as the other chart suites:
# a hash-comment above the test function it verifies.
#
# Values files matter here: Helm hands a number written in a file to the
# templates as a float (1e+09), while `--set` keeps an integer. Both are
# exercised, because the file form is the one a plain-bytes value arrives in.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/redis-maxmemory.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
overlays="examples/overlays"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

render_redis() {
  helm template lw . \
    --set autogen.enabled=true \
    --set app.dataplane.enabled=true \
    --set langyagent.chartManaged=false \
    --show-only templates/redis/statefulset.yaml \
    "$@"
}

command_line() {
  printf '%s' "$1" | grep -E '^ +command:'
}

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Writes a values file holding one Redis memory setting and prints its path.
values_file() {
  local name="$1" key="$2" value="$3"
  case "$key" in
  limit) printf 'redis:\n  master:\n    resources:\n      limits:\n        memory: %s\n' "$value" >"$scratch/$name.yaml" ;;
  override) printf 'redis:\n  master:\n    maxmemory: %s\n' "$value" >"$scratch/$name.yaml" ;;
  esac
  printf '%s' "$scratch/$name.yaml"
}

expect_maxmemory() {
  local label="$1" want="$2" block line got
  shift 2
  block=$(render_redis "$@")
  line=$(command_line "$block")
  got=$(printf '%s' "$line" | grep -oE -- '--maxmemory[", ]+[0-9]+' | grep -oE '[0-9]+$' || true)
  if [ "$got" = "$want" ]; then
    echo "ok   [$label] --maxmemory $got"
    return
  fi
  fail "$label" "--maxmemory ${got:-<absent>}, expected $want"
}

expect_failure() {
  local label="$1" want="$2" output
  shift 2
  if output=$(render_redis "$@" 2>&1); then
    fail "$label" "rendered, expected a refusal"
    return
  fi
  if printf '%s' "$output" | grep -q -- "$want"; then
    echo "ok   [$label] refused"
    return
  fi
  fail "$label" "refused without \"$want\""
}

# @scenario "The ceiling is half of the memory limit"
test_ceiling_is_half_of_the_limit() {
  expect_maxmemory "default values (512Mi)" 268435456
  expect_maxmemory "size-minimal (128Mi)" 67108864 -f "$overlays/size-minimal.yaml"
  expect_maxmemory "size-dev (256Mi)" 134217728 -f "$overlays/size-dev.yaml"
  expect_maxmemory "size-prod (3Gi)" 1610612736 -f "$overlays/size-prod.yaml"
  expect_maxmemory "size-ha (3Gi)" 1610612736 -f "$overlays/size-ha.yaml"
  expect_maxmemory "decimal limit (1.5Gi)" 805306368 --set redis.master.resources.limits.memory=1.5Gi
  expect_maxmemory "decimal suffix (2G)" 1000000000 --set redis.master.resources.limits.memory=2G
  expect_maxmemory "plain bytes via --set" 500000000 --set redis.master.resources.limits.memory=1000000000
}

# @scenario "Production and HA profiles give Redis three gibibytes"
test_prod_and_ha_give_redis_three_gibibytes() {
  local profile block limits
  for profile in size-prod size-ha; do
    block=$(render_redis -f "$overlays/$profile.yaml")
    limits=$(printf '%s\n' "$block" | awk '/limits:/ { n = 3 } n > 0 { printf "%s", $0; n-- }' | tr -d ' ')
    if [ "$limits" = 'limits:cpu:1memory:3Gi' ]; then
      echo "ok   [$profile] limits 1 CPU / 3Gi"
    else
      fail "$profile" "limits were $limits"
    fi
  done
}

# @scenario "Both ways of starting Redis carry the ceiling"
test_both_command_forms_carry_the_ceiling() {
  local prod_auth prod_open
  prod_auth=$(render_redis -f "$overlays/size-prod.yaml")
  if [[ "$prod_auth" == *'exec redis-server --maxmemory-policy noeviction --maxmemory 1610612736 --requirepass'* ]]; then
    echo "ok   [auth on] exec form kept"
  else
    fail "auth on" "exec redis-server form changed"
  fi

  prod_open=$(render_redis -f "$overlays/size-prod.yaml" --set redis.auth.enabled=false)
  if [[ "$prod_open" == *'"redis-server", "--maxmemory-policy", "noeviction", "--maxmemory", "1610612736"'* ]]; then
    echo "ok   [auth off] argv form kept"
  else
    fail "auth off" "redis-server argv form changed"
  fi
  expect_maxmemory "auth off, small limit" 67108864 \
    -f "$overlays/size-minimal.yaml" --set redis.auth.enabled=false
}

# @scenario "An explicit ceiling wins over the computed one"
test_explicit_override_wins() {
  expect_maxmemory "override in bytes" 1000000000 \
    -f "$overlays/size-prod.yaml" --set redis.master.maxmemory=1000000000
  expect_maxmemory "override as a size" 2147483648 \
    -f "$overlays/size-prod.yaml" --set redis.master.maxmemory=2Gi
}

# @scenario "A plain number in a values file is read as bytes"
test_plain_number_in_a_values_file_is_bytes() {
  local limit_file override_file
  limit_file=$(values_file limit-bytes limit 1000000000)
  expect_maxmemory "limit 1000000000 from a file" 500000000 -f "$limit_file"
  limit_file=$(values_file limit-large limit 3221225472)
  expect_maxmemory "limit 3221225472 from a file" 1610612736 -f "$limit_file"
  limit_file=$(values_file limit-quoted limit '"1000000000"')
  expect_maxmemory "quoted limit from a file" 500000000 -f "$limit_file"
  override_file=$(values_file override-bytes override 1000000000)
  expect_maxmemory "override 1000000000 from a file" 1000000000 \
    -f "$overlays/size-prod.yaml" -f "$override_file"
  override_file=$(values_file override-large override 4294967296)
  expect_maxmemory "override 4294967296 from a file" 4294967296 \
    -f "$overlays/size-prod.yaml" -f "$override_file"
  override_file=$(values_file override-size override 2Gi)
  expect_maxmemory "override 2Gi from a file" 2147483648 \
    -f "$overlays/size-prod.yaml" -f "$override_file"
}

# @scenario "A memory value the chart cannot read is refused"
test_unreadable_value_is_refused() {
  expect_failure "unparseable limit" "is not a size" \
    --set redis.master.resources.limits.memory=lots
  expect_failure "unparseable override" "is not a size" \
    --set redis.master.maxmemory=1gb
  expect_failure "unparseable limit from a file" "is not a size" \
    -f "$(values_file limit-bad limit lots)"
}

# @scenario "With no memory limit Redis gets no ceiling"
test_no_limit_means_no_ceiling() {
  local block
  block=$(render_redis --set redis.master.resources=null)
  if command_line "$block" | grep -q -- '--maxmemory '; then
    fail "no limit" "--maxmemory rendered without a limit"
  elif command_line "$block" | grep -q -- '"--maxmemory"'; then
    fail "no limit" "--maxmemory rendered without a limit"
  else
    echo "ok   [no limit] no --maxmemory"
  fi
}

test_ceiling_is_half_of_the_limit
test_prod_and_ha_give_redis_three_gibibytes
test_both_command_forms_carry_the_ceiling
test_explicit_override_wins
test_plain_number_in_a_values_file_is_bytes
test_unreadable_value_is_refused
test_no_limit_means_no_ceiling

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures redis maxmemory check(s) failed"
  exit 1
fi

echo
echo "all redis maxmemory checks pass"

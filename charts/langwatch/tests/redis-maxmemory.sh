#!/usr/bin/env bash
# Redis starts with --maxmemory at half of its memory limit (or the explicit
# override), so a snapshot's copied pages fit under the container limit.

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

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

expect_maxmemory() {
  local label="$1" want="$2"
  shift 2
  local block line got
  block=$(render_redis "$@")
  line=$(command_line "$block")
  got=$(printf '%s' "$line" | grep -oE -- '--maxmemory[", ]+[0-9]+' | grep -oE '[0-9]+$' || true)
  if [ "$got" = "$want" ]; then
    echo "ok   [$label] --maxmemory $got"
    return
  fi

  echo "FAIL [$label] --maxmemory ${got:-<absent>}, expected $want"
  failures=$((failures + 1))
}

expect_failure() {
  local label="$1" want="$2" output
  shift 2
  if output=$(render_redis "$@" 2>&1); then
    echo "FAIL [$label] rendered, expected a refusal"
    failures=$((failures + 1))
    return
  fi
  if printf '%s' "$output" | grep -q -- "$want"; then
    echo "ok   [$label] refused"
    return
  fi

  echo "FAIL [$label] refused without \"$want\""
  failures=$((failures + 1))
}

overlays="examples/overlays"

expect_maxmemory "default values (512Mi)" 268435456
expect_maxmemory "size-minimal (128Mi)" 67108864 -f "$overlays/size-minimal.yaml"
expect_maxmemory "size-dev (256Mi)" 134217728 -f "$overlays/size-dev.yaml"
expect_maxmemory "size-prod (3Gi)" 1610612736 -f "$overlays/size-prod.yaml"
expect_maxmemory "size-ha (3Gi)" 1610612736 -f "$overlays/size-ha.yaml"
expect_maxmemory "decimal limit (1.5Gi)" 805306368 --set redis.master.resources.limits.memory=1.5Gi
expect_maxmemory "plain bytes limit" 500000 --set redis.master.resources.limits.memory=1000000
expect_maxmemory "decimal suffix (2G)" 1000000000 --set redis.master.resources.limits.memory=2G
expect_maxmemory "explicit override wins" 1000000000 \
  -f "$overlays/size-prod.yaml" --set redis.master.maxmemory=1000000000
expect_maxmemory "override takes a size" 2147483648 \
  -f "$overlays/size-prod.yaml" --set redis.master.maxmemory=2Gi
expect_maxmemory "auth off (3Gi)" 1610612736 \
  -f "$overlays/size-prod.yaml" --set redis.auth.enabled=false
expect_maxmemory "auth off, small limit" 67108864 \
  -f "$overlays/size-minimal.yaml" --set redis.auth.enabled=false

expect_failure "unparseable limit" "is not a size" \
  --set redis.master.resources.limits.memory=lots
expect_failure "unparseable override" "is not a size" \
  --set redis.master.maxmemory=1gb

no_limit=$(render_redis --set redis.master.resources=null)
if command_line "$no_limit" | grep -q -- '--maxmemory '; then
  echo "FAIL [no limit] --maxmemory rendered without a limit"
  failures=$((failures + 1))
elif command_line "$no_limit" | grep -q -- '"--maxmemory"'; then
  echo "FAIL [no limit] --maxmemory rendered without a limit"
  failures=$((failures + 1))
else
  echo "ok   [no limit] no --maxmemory"
fi

prod_auth=$(render_redis -f "$overlays/size-prod.yaml")
if [[ "$prod_auth" == *'exec redis-server --maxmemory-policy noeviction --maxmemory 1610612736 --requirepass'* ]]; then
  echo "ok   [auth on] exec form kept"
else
  echo "FAIL [auth on] exec redis-server form changed"
  failures=$((failures + 1))
fi

prod_open=$(render_redis -f "$overlays/size-prod.yaml" --set redis.auth.enabled=false)
if [[ "$prod_open" == *'"redis-server", "--maxmemory-policy", "noeviction", "--maxmemory", "1610612736"'* ]]; then
  echo "ok   [auth off] argv form kept"
else
  echo "FAIL [auth off] redis-server argv form changed"
  failures=$((failures + 1))
fi

limits=$(printf '%s\n' "$prod_auth" | awk '/limits:/ { n = 3 } n > 0 { printf "%s", $0; n-- }' | tr -d ' ')
if [ "$limits" = 'limits:cpu:1memory:3Gi' ]; then
  echo "ok   [size-prod] limits 1 CPU / 3Gi"
else
  echo "FAIL [size-prod] limits were $limits"
  failures=$((failures + 1))
fi

if [ "$failures" -ne 0 ]; then
  exit 1
fi

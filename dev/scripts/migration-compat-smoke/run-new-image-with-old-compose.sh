#!/usr/bin/env bash
# Runs the PREVIOUS release's compose file against a NEW image, as an operator who
# upgrades only the image tag would: the old `workers` service still says
# `cd /app/platform/app && pnpm run start:workers`, the old env_file is still
# platform/app/.env. Then it runs the same image as one container with
# START_WORKERS=true, and once more with PORT=8080.
#
# Usage: run-new-image-with-old-compose.sh IMAGE [OLD_REF]
#   IMAGE    a locally built tag of infra/docker/Dockerfile
#   OLD_REF  the previous release's commit (default 73787aa2a7)
# Needs docker with compose >= 2.24 (the override uses !reset) and git, run inside the checkout.
# Publishes no host port: every probe is a curl inside the container.
set -euo pipefail

image="${1:?usage: run-new-image-with-old-compose.sh IMAGE [OLD_REF]}"
old_ref="${2:-73787aa2a7}"
wait_seconds="${WAIT_SECONDS:-900}"
repo="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
project="langwatch-compat-$$"
failures=0

mkdir -p "${work}/platform/app"
git -C "$repo" show "${old_ref}:infra/compose.yml" >"${work}/compose.yml" \
  || { echo "::error::cannot read infra/compose.yml at ${old_ref}"; exit 1; }

secret() { openssl rand -hex 32; }
cat >"${work}/platform/app/.env" <<EOF
BASE_HOST=http://localhost:5560
NEXTAUTH_URL=http://localhost:5560
ADMIN_EMAILS=compat@example.com
NEXTAUTH_SECRET=$(secret)
CREDENTIALS_SECRET=$(secret)
API_TOKEN_JWT_SECRET=$(secret)
LW_VIRTUAL_KEY_PEPPER=$(secret)
LW_GATEWAY_INTERNAL_SECRET=$(secret)
LW_GATEWAY_JWT_SECRET=$(secret)
EOF

# The local tag, never a pull; no host ports, so the run never collides with a dev stack.
cat >"${work}/override.yml" <<EOF
services:
  app:
    image: ${image}
    pull_policy: never
    ports: !reset []
  workers:
    image: ${image}
    pull_policy: never
  postgres:
    ports: !reset []
  clickhouse:
    ports: !reset []
EOF

compose() {
  docker compose -p "$project" --project-directory "$work" \
    -f "${work}/compose.yml" -f "${work}/override.yml" "$@"
}

extra=""
finish() {
  for service in app workers; do
    echo "--- ${service} log"
    compose logs --no-color --tail 200 "$service" 2>&1 || true
  done
  [ -n "$extra" ] && { echo "--- ${extra} log"; docker logs --tail 200 "$extra" 2>&1 || true; }
  [ -n "$extra" ] && docker rm -f "$extra" >/dev/null 2>&1 || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap finish EXIT

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ok    ${label}"
  else
    echo "FAIL  ${label}"
    failures=$((failures + 1))
  fi
}

# wait_for LABEL CONTAINER URL: the url answers 2xx inside the container.
wait_for() {
  local label="$1" container="$2" url="$3" waited=0
  until docker exec "$container" curl -fsS -o /dev/null "$url"; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$container")" != "true" ]; then
      echo "FAIL  ${label}: the container exited"
      failures=$((failures + 1))
      return 1
    fi
    waited=$((waited + 5))
    if [ "$waited" -ge "$wait_seconds" ]; then
      echo "FAIL  ${label}: no answer from ${url} in ${wait_seconds}s"
      failures=$((failures + 1))
      return 1
    fi
    sleep 5
  done
  echo "ok    ${label} (${waited}s)"
}

# The image's shape: the UI is its bundle only, no devDependencies, and the forwarding folder.
echo "== image shape"
shape() { docker run --rm --entrypoint bash "$image" -c "$1"; }
check "UI bundle shipped" shape 'test -f /app/apps/ui/dist/client/index.html'
check "no UI source or packages" shape '! test -e /app/apps/ui/src && ! test -e /app/apps/ui/node_modules'
check "no source maps in the bundle" shape '! find /app/apps/ui/dist/client -name "*.map" | grep -q .'
check "no dev toolchain in node_modules" shape '! ls /app/node_modules/.pnpm | grep -Eq "^(vite|vitest|playwright)@"'
check "backend app present" shape 'test -f /app/apps/backend/src/main.ts'
check "forwarding folder present" shape 'test -f /app/platform/app/package.json && test -x /app/start.sh'
check "old task with no equivalent exits 2" \
  shape 'cd /app/platform/app && pnpm run task cleanupOldLambdas; test $? -eq 2'
check "old task names listed" shape 'cd /app/platform/app && pnpm run task 2>&1 | grep -q renderLwqlAccessConfig'

# Scenario 1: the old compose file, as written.
echo "== old compose file, new image"
compose up -d postgres redis clickhouse app workers
app="$(compose ps -q app)"
worker="$(compose ps -q workers)"
wait_for "app answers /api/health on 5560" "$app" http://127.0.0.1:5560/api/health || true
wait_for "worker answers /healthz on 2999" "$worker" http://127.0.0.1:2999/healthz || true
# The api stays not ready until the upgrade ledger is current, and only the worker runs the upgrade.
wait_for "upgrade ran: app ready on /readyz" "$app" http://127.0.0.1:5560/readyz || true
check "worker log names no failed upgrade" bash -c \
  "! docker logs ${worker} 2>&1 | grep -Eiq 'upgrade (failed|refused)'"
check "old start:prepare:db forwards to the upgrade" \
  docker exec "$worker" bash -c 'cd /app/platform/app && pnpm run start:prepare:db'
check "no missing module in either log" bash -c \
  "! { docker logs ${app} 2>&1; docker logs ${worker} 2>&1; } | grep -Eq 'ERR_MODULE_NOT_FOUND|Cannot find module|ERR_PNPM'"

# Scenarios 2 and 3 run beside the databases only: stop the two services of scenario 1.
compose stop app workers >/dev/null

run_extra() {
  extra="$(compose run -d --no-deps --name "${project}-extra" "$@" app)"
}

echo "== START_WORKERS=true, one container"
run_extra -e START_WORKERS=true
wait_for "api answers /api/health on 5560" "$extra" http://127.0.0.1:5560/api/health || true
wait_for "worker answers /healthz on 2999 in the same container" "$extra" http://127.0.0.1:2999/healthz || true
wait_for "ready on /readyz (the upgrade ran)" "$extra" http://127.0.0.1:5560/readyz || true
docker rm -f "$extra" >/dev/null
extra=""

echo "== PORT=8080"
run_extra -e PORT=8080
wait_for "api answers /api/health on 8080" "$extra" http://127.0.0.1:8080/api/health || true
check "api does not listen on 5560" bash -c \
  "! docker exec ${extra} curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:5560/api/health"
# The HEALTHCHECK has a 30s interval; it must follow PORT to ever report healthy.
waited=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$extra")" = "healthy" ]; do
  waited=$((waited + 5))
  if [ "$waited" -ge 180 ]; then
    echo "FAIL  HEALTHCHECK follows PORT: still $(docker inspect -f '{{.State.Health.Status}}' "$extra") after 180s"
    failures=$((failures + 1))
    break
  fi
  sleep 5
done
[ "$waited" -lt 180 ] && echo "ok    HEALTHCHECK follows PORT (${waited}s)"

echo "== ${failures} failure(s)"
[ "$failures" -eq 0 ]

#!/usr/bin/env bash
# Starts one old image's web and worker on head's migrated schema, as a rollback
# or pods still serving mid-rollout would, then runs the HTTP smoke and scans
# both logs for a table or column head no longer has. Usage: run-old-image.sh LABEL IMAGE
# Needs DATABASE_URL, REDIS_URL and CLICKHOUSE_URL (with its database) set.
set -euo pipefail

label="${1:?label}"
image="${2:?image}"
: "${DATABASE_URL:?}" "${REDIS_URL:?}" "${CLICKHOUSE_URL:?}"
here="$(cd "$(dirname "$0")" && pwd)"
app_base="http://localhost:5560"
name="compat-${label}"
email="compat-${label}@example.com"
password="Compat-$(openssl rand -hex 16)"
worker="${name}-worker"

finish() {
  for c in "$name" "$worker"; do
    echo "--- ${c} log"
    docker logs "$c" 2>&1 | tail -n 200 || true
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
}
trap finish EXIT

secret() { openssl rand -hex 32; }
env=(
  -e NODE_ENV=production -e INSTALL_METHOD=docker -e SKIP_ENV_VALIDATION=true
  -e DATABASE_URL="$DATABASE_URL" -e REDIS_URL="$REDIS_URL"
  -e CLICKHOUSE_URL="$CLICKHOUSE_URL" -e CLICKHOUSE_BACKUP_METRICS_ENABLED=false
  -e BASE_HOST="$app_base" -e NEXTAUTH_URL="$app_base" -e ADMIN_EMAILS="$email"
  -e NEXTAUTH_SECRET="$(secret)" -e CREDENTIALS_SECRET="$(secret)"
  -e API_TOKEN_JWT_SECRET="$(secret)" -e LW_VIRTUAL_KEY_PEPPER="$(secret)"
  -e LW_GATEWAY_INTERNAL_SECRET="$(secret)" -e LW_GATEWAY_JWT_SECRET="$(secret)"
)
docker run -d --name "$name" --network host "${env[@]}" "$image" >/dev/null

for attempt in $(seq 1 120); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ]; then
    echo "::error title=migration-compat::${label} (${image}) exited on head's schema"
    exit 1
  fi
  if curl -fsS -o /dev/null "${app_base}/api/health"; then
    echo "${label} healthy after ${attempt} probes"
    break
  fi
  if [ "$attempt" -eq 120 ]; then
    echo "::error title=migration-compat::${label} (${image}) never answered /api/health on head's schema"
    exit 1
  fi
  sleep 5
done

# The web role only appends commands; the worker folds them (a grant write waits
# for its fold), so the smoke needs the old image's worker as production runs it.
docker run -d --name "$worker" --network host -w /app/platform/app "${env[@]}" "$image" \
  pnpm run start:workers >/dev/null
for attempt in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$worker")" != "true" ]; then
    echo "::error title=migration-compat::${label} (${image}) worker exited on head's schema"
    exit 1
  fi
  if curl -fsS -o /dev/null "http://localhost:2999/healthz"; then
    echo "${label} worker healthy after ${attempt} probes"
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "::error title=migration-compat::${label} (${image}) worker never answered /healthz on head's schema"
    exit 1
  fi
  sleep 5
done

bash "${here}/seed-account.sh" "$email" "$password"
APP_BASE="$app_base" SMOKE_EMAIL="$email" SMOKE_PASSWORD="$password" SMOKE_LABEL="$label" \
  node "${here}/smoke.mjs"

# Background work the smoke started reads and writes the tables it knows.
sleep 30
missing="$({ docker logs "$name" 2>&1; docker logs "$worker" 2>&1; } | grep -E '(column|relation) "[^"]+" does not exist|P2021|P2022|Code: (47|60)\.' || true)"
if [ -n "$missing" ]; then
  echo "::error title=migration-compat::${label} (${image}) reads something head's schema no longer has"
  echo "$missing"
  exit 1
fi
echo "${label} (${image}) passed the smoke on head's schema"

#!/usr/bin/env bash
#
# connect.sh — wire local dev into the local observability stack.
#
# Idempotent. Run after `make observability` is up. It:
#   1. points langwatch/.env at the local collector (traces + logs + metrics),
#      backing up the current .env first;
#   2. mints a Grafana service-account token for read access;
#   3. configures the `gcx` CLI (Grafana's official CLI) with that token so an
#      agent can query the local logs/traces/metrics from the shell.
#
# Nothing here is secret — the stack is local-only (admin/admin, never exposed
# off-host). Re-run any time; it converges.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/langwatch/.env"
GRAFANA_PORT="${LW_OBS_GRAFANA_PORT:-3000}"
GRAFANA_URL="http://localhost:${GRAFANA_PORT}"
OTLP_ENDPOINT="http://localhost:${LW_OBS_OTLP_HTTP_PORT:-4318}"

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Point langwatch/.env at the local collector
# ---------------------------------------------------------------------------
set_env_var() { # key value file — replace existing (even commented) line, else append
  local key="$1" val="$2" file="$3"
  if grep -qE "^[#[:space:]]*${key}=" "$file"; then
    # macOS/BSD sed in-place. Match a possibly-commented assignment.
    sed -i.tmp -E "s|^[#[:space:]]*${key}=.*|${key}=${val}|" "$file" && rm -f "${file}.tmp"
  else
    printf '%s=%s\n' "$key" "$val" >>"$file"
  fi
}

if [ -f "$ENV_FILE" ]; then
  backup="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$backup"
  say "Backed up ${ENV_FILE#"$REPO_ROOT"/} → ${backup#"$REPO_ROOT"/}"

  set_env_var OTEL_EXPORTER_OTLP_ENDPOINT      "$OTLP_ENDPOINT" "$ENV_FILE"
  set_env_var OTEL_EXPORTER_OTLP_HEADERS       ""              "$ENV_FILE"
  set_env_var PINO_OTEL_ENABLED                "true"          "$ENV_FILE"
  set_env_var OTEL_METRICS_ENABLED             "true"          "$ENV_FILE"
  # Unified log levels — read by BOTH the TS app and the Go services: keep the
  # console quiet (warnings/errors only) while info+debug flow to the stack.
  set_env_var LOG_CONSOLE_LEVEL                "warn"          "$ENV_FILE"
  set_env_var LOG_OTEL_LEVEL                   "debug"         "$ENV_FILE"
  set_env_var OTEL_DEBUG_COLLECTOR_ENDPOINT    "$OTLP_ENDPOINT" "$ENV_FILE"
  set_env_var OTEL_DEBUG_COLLECTOR_HEADERS     ""              "$ENV_FILE"

  # Tag all telemetry from THIS worktree so an agent can filter to it in
  # Grafana when several worktrees share the local collector. Both the TS SDK
  # (envDetector) and the Go SDK (resource.Default) read OTEL_RESOURCE_ATTRIBUTES.
  worktree_name="$(basename "$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null || echo "$REPO_ROOT")")"
  set_env_var OTEL_RESOURCE_ATTRIBUTES "langwatch.worktree=${worktree_name}" "$ENV_FILE"
  say "Pointed langwatch/.env at ${OTLP_ENDPOINT} (TS traces+logs+metrics, Go dual-export)."
  say "Tagged telemetry with langwatch.worktree=${worktree_name}."
else
  warn "langwatch/.env not found — skipping .env wiring. Set these yourself:"
  cat <<EOF
  OTEL_EXPORTER_OTLP_ENDPOINT=${OTLP_ENDPOINT}
  PINO_OTEL_ENABLED=true
  LOG_CONSOLE_LEVEL=warn
  LOG_OTEL_LEVEL=debug
  OTEL_METRICS_ENABLED=true
  OTEL_DEBUG_COLLECTOR_ENDPOINT=${OTLP_ENDPOINT}
  OTEL_DEBUG_COLLECTOR_HEADERS=
EOF
fi

# ---------------------------------------------------------------------------
# 2. Mint a Grafana service-account token
# ---------------------------------------------------------------------------
say "Waiting for Grafana at ${GRAFANA_URL} ..."
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "${GRAFANA_URL}/api/health"; then break; fi
  sleep 2
done
if ! curl -sf -o /dev/null "${GRAFANA_URL}/api/health"; then
  warn "Grafana not reachable at ${GRAFANA_URL}. Is the stack up? (make observability)"
  exit 1
fi

AUTH="admin:admin"
SA_NAME="langwatch-gcx"

# Reuse the service account if it already exists, else create it.
sa_id="$(curl -sf -u "$AUTH" "${GRAFANA_URL}/api/serviceaccounts/search?query=${SA_NAME}" \
  | python3 -c "import sys,json; sa=[a for a in json.load(sys.stdin).get('serviceAccounts',[]) if a['name']=='${SA_NAME}']; print(sa[0]['id'] if sa else '')" 2>/dev/null || true)"
if [ -z "$sa_id" ]; then
  sa_id="$(curl -sf -u "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"name\":\"${SA_NAME}\",\"role\":\"Admin\",\"isDisabled\":false}" \
    "${GRAFANA_URL}/api/serviceaccounts" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")"
  say "Created Grafana service account '${SA_NAME}' (id=${sa_id})."
else
  say "Reusing Grafana service account '${SA_NAME}' (id=${sa_id})."
fi

TOKEN="$(curl -sf -u "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"gcx-$(date +%s)\"}" \
  "${GRAFANA_URL}/api/serviceaccounts/${sa_id}/tokens" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")"
if [ -z "$TOKEN" ]; then warn "Failed to mint Grafana token."; exit 1; fi
say "Minted a Grafana service-account token."

# ---------------------------------------------------------------------------
# 3. Configure gcx (Grafana CLI) so an agent can query from the shell
# ---------------------------------------------------------------------------
if command -v gcx >/dev/null 2>&1; then
  if gcx login local --server "$GRAFANA_URL" --token "$TOKEN" --yes >/dev/null 2>&1; then
    say "Configured gcx context 'local' → ${GRAFANA_URL}. Try: gcx datasources list"
  else
    warn "gcx login failed (needs Grafana v12+). Query the raw Grafana HTTP API instead."
  fi
else
  warn "gcx not installed — skip shell queries. Install: brew install grafana/grafana/gcx"
fi

echo
say "Done. Grafana: ${GRAFANA_URL}  (anonymous Admin, or admin/admin)"
say "Restart your app (pnpm dev / make quickstart) so it picks up the new .env."

#!/usr/bin/env bash
# Doctor for running Langy locally: one pass over everything a local Langy
# turn needs, with the exact fix printed for whatever is missing.
#
# Langy locally = the app (pnpm dev), the AI gateway (auto-started by pnpm
# dev), and the langyagent Go service running the no-sandbox dev runner
# (gVisor does not exist on macOS), plus a handful of env entries in
# langwatch/.env and the release flag force-enabled. Each missing piece fails
# a turn with a different distant symptom, this script fails them all HERE,
# named, instead.
#
# Usage:
#   scripts/dogfood/langy-local.sh          # run all checks
#   scripts/dogfood/langy-local.sh --fix    # also append the missing env block to langwatch/.env
#
# Spec: specs/setup/langy-local-dogfood.feature
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/langwatch/.env"
APP_PORT="${PORT:-5560}"
GATEWAY_PORT=$((APP_PORT + 3))
AGENT_PORT="${LANGY_AGENT_PORT:-8080}"
FIX=false
[[ "${1:-}" == "--fix" ]] && FIX=true

failures=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; failures=$((failures + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
hint() { printf '      %s\n' "$1"; }

env_has() { grep -qE "^$1=" "$ENV_FILE" 2>/dev/null; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

echo "Langy local dogfood doctor ($ENV_FILE)"

# --- env block -------------------------------------------------------------
echo "env:"
missing_env=()
for key in OPENCODE_AGENT_URL LANGY_INTERNAL_SECRET LANGY_UNSAFE_DEV_DISABLE_ISOLATION SESSIONS_ROOT LANGY_WORKSPACE_ROOT; do
  if env_has "$key"; then ok "$key"; else bad "$key missing"; missing_env+=("$key"); fi
done

if [[ ${#missing_env[@]} -gt 0 ]]; then
  SECRET="$(openssl rand -hex 32)"
  BLOCK=$(cat <<BLOCK

# Langy local dev (agent runs without gVisor via the unsafe-dev runner)
OPENCODE_AGENT_URL="http://localhost:${AGENT_PORT}"
LANGY_INTERNAL_SECRET="${SECRET}"
LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true
SESSIONS_ROOT="\$HOME/.langwatch-langy/sessions"
LANGY_WORKSPACE_ROOT="\$HOME/.langwatch-langy/workspace"
BLOCK
)
  if $FIX; then
    printf '%s\n' "$BLOCK" | sed "s|\$HOME|$HOME|g" >>"$ENV_FILE"
    mkdir -p "$HOME/.langwatch-langy/sessions" "$HOME/.langwatch-langy/workspace"
    warn "appended the Langy env block to langwatch/.env (restart pnpm dev + langyagent to pick it up)"
  else
    hint "add to langwatch/.env (or re-run with --fix):"
    printf '%s\n' "$BLOCK" | sed 's/^/      /'
  fi
fi

if grep -qE '^FEATURE_FLAG_FORCE_ENABLE=.*release_langy_enabled' "$ENV_FILE" 2>/dev/null; then
  ok "release_langy_enabled force-enabled"
else
  bad "release_langy_enabled not in FEATURE_FLAG_FORCE_ENABLE"
  hint 'append ",release_langy_enabled" to the FEATURE_FLAG_FORCE_ENABLE= line (or add the line)'
fi

# --- binaries --------------------------------------------------------------
echo "binaries:"
if command -v opencode >/dev/null 2>&1; then
  ok "opencode ($(command -v opencode))"
else
  bad "opencode not on PATH (the langyagent spawns it per conversation)"
  hint "npm install -g opencode-ai"
fi
if command -v go >/dev/null 2>&1; then
  ok "go toolchain"
else
  bad "go not on PATH (langyagent and the gateway are Go services)"
fi

# --- services --------------------------------------------------------------
echo "services:"
if listening "$APP_PORT"; then ok "app on :$APP_PORT"; else
  bad "app not listening on :$APP_PORT"
  hint "cd langwatch && pnpm dev"
fi
if listening "$GATEWAY_PORT"; then ok "AI gateway on :$GATEWAY_PORT"; else
  bad "AI gateway not listening on :$GATEWAY_PORT"
  hint "auto-starts with pnpm dev when Go is on PATH, or: make service svc=aigateway"
fi
if listening "$AGENT_PORT"; then ok "langyagent on :$AGENT_PORT"; else
  bad "langyagent not listening on :$AGENT_PORT"
  hint "make service svc=langyagent   (sources langwatch/.env; runs the no-sandbox dev runner)"
fi

# --- provider keys ---------------------------------------------------------
# Advisory: a rejected key fails turns with a distant mid-stream symptom, so
# name it here. A rejection does not fail the doctor, another provider's key
# may be the one in use.
echo "provider keys (advisory):"
check_key() {
  local name="$1" url="$2" header="$3" extra_header="${4:-}"
  local key
  key="$(grep -E "^${name}=" "$ENV_FILE" 2>/dev/null | head -1 | sed -E "s/^${name}=//; s/\"//g")"
  if [[ -z "$key" ]]; then
    warn "$name not set"
    return
  fi
  local -a curl_args=(-s -o /dev/null -w '%{http_code}' --max-time 10 "$url" -H "${header}${key}")
  [[ -n "$extra_header" ]] && curl_args+=(-H "$extra_header")
  local code
  code="$(curl "${curl_args[@]}")"
  if [[ "$code" == "200" ]]; then
    ok "$name accepted by the provider"
  else
    warn "$name REJECTED by the provider (HTTP $code), turns on this provider will fail"
  fi
}
check_key OPENAI_API_KEY "https://api.openai.com/v1/models" "Authorization: Bearer "
check_key ANTHROPIC_API_KEY "https://api.anthropic.com/v1/models" "x-api-key: " "anthropic-version: 2023-06-01"

# --- verdict ---------------------------------------------------------------
echo
if [[ $failures -eq 0 ]]; then
  echo "all checks passed, open http://localhost:${APP_PORT}, pick a model in the Langy composer, and ask it something"
  exit 0
fi
echo "$failures check(s) failed, fix the ✗ items above and re-run"
exit 1

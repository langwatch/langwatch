#!/usr/bin/env bash
# Doctor for running Langy locally: one pass over everything a local Langy
# turn needs, with the exact fix printed for whatever is missing.
#
# Langy locally = the app (pnpm dev), the AI gateway (auto-started by pnpm
# dev), and the langyagent Go service running the no-sandbox dev runner
# (gVisor does not exist on macOS), plus a handful of env entries in
# platform/app/.env and the release flag force-enabled. Each missing piece fails
# a turn with a different distant symptom, this script fails them all HERE,
# named, instead.
#
# Usage:
#   dev/scripts/dogfood/langy-local.sh          # run all checks
#   dev/scripts/dogfood/langy-local.sh --fix    # also append the missing env block to platform/app/.env
#
# Spec: specs/setup/langy-local-dogfood.feature
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE="$ROOT/platform/app/.env"
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

# env_value prints the (unquoted) value of a key in platform/app/.env; empty when
# the key is absent OR set to nothing, so presence checks require a real value.
env_value() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | sed -E "s/^$1=//; s/\"//g"; }

# listening prefers lsof; a machine without it falls back to a bash /dev/tcp
# connect probe so a missing utility never reads as three dead services.
if command -v lsof >/dev/null 2>&1; then
  listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
else
  listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3>&- 3<&-; }
fi

echo "Langy local dogfood doctor ($ENV_FILE)"

# --- env block -------------------------------------------------------------
echo "env:"
missing_env=()
for key in OPENCODE_AGENT_URL LANGY_INTERNAL_SECRET SESSIONS_ROOT LANGY_WORKSPACE_ROOT; do
  if [[ -n "$(env_value "$key")" ]]; then ok "$key"; else bad "$key missing"; missing_env+=("$key"); fi
done
# The isolation posture must be "none". Unset means per-uid (ADR-130's default),
# which needs root plus CAP_SETUID/SETGID/CHOWN to hand each worker its own
# identity — capabilities a laptop process does not hold. Every spawn then dies
# at the first chown, so a missing value fails here rather than at first message.
case "$(env_value LANGY_WORKER_ISOLATION)" in
  none) ok "LANGY_WORKER_ISOLATION" ;;
  "") bad "LANGY_WORKER_ISOLATION missing"; missing_env+=(LANGY_WORKER_ISOLATION) ;;
  *) bad "LANGY_WORKER_ISOLATION must be none for a local agent (per-uid needs root)" ;;
esac
# The roots must be writable directories or the worker provision fails at
# spawn with a distant chown/mkdir error.
for key in SESSIONS_ROOT LANGY_WORKSPACE_ROOT; do
  dir="$(env_value "$key")"
  if [[ -n "$dir" && ( ! -d "$dir" || ! -w "$dir" ) ]]; then
    bad "$key ($dir) is not a writable directory"
    hint "mkdir -p \"$dir\""
  fi
done

if [[ ${#missing_env[@]} -gt 0 ]]; then
  SECRET="$(openssl rand -hex 32)" || SECRET=""
  if [[ -z "$SECRET" ]]; then
    bad "openssl could not generate LANGY_INTERNAL_SECRET"
  else
    BLOCK=$(cat <<BLOCK

# Langy local dev (no sandboxed runtime, workers share this machine's identity)
OPENCODE_AGENT_URL="http://localhost:${AGENT_PORT}"
LANGY_INTERNAL_SECRET="${SECRET}"
LANGY_WORKER_ISOLATION=none
SESSIONS_ROOT="\$HOME/.langwatch-langy/sessions"
LANGY_WORKSPACE_ROOT="\$HOME/.langwatch-langy/workspace"
BLOCK
)
    if $FIX; then
      if printf '%s\n' "$BLOCK" | sed "s|\$HOME|$HOME|g" >>"$ENV_FILE" &&
        mkdir -p "$HOME/.langwatch-langy/sessions" "$HOME/.langwatch-langy/workspace"; then
        warn "appended the Langy env block to platform/app/.env (restart pnpm dev + langyagent to pick it up)"
      else
        bad "could not write the env block or create the session/workspace roots"
      fi
    else
      hint "add to platform/app/.env (or re-run with --fix):"
      printf '%s\n' "$BLOCK" | sed 's/^/      /'
    fi
  fi
fi

# Boundary-aware: release_langy_enabled must be a complete comma-separated
# entry, not a prefix of another flag name.
if grep -E '^FEATURE_FLAG_FORCE_ENABLE=' "$ENV_FILE" 2>/dev/null |
  grep -qE '[=,]"?release_langy_enabled"?(,|"?$)'; then
  ok "release_langy_enabled force-enabled"
else
  bad "release_langy_enabled not in FEATURE_FLAG_FORCE_ENABLE"
  hint 'append ",release_langy_enabled" to the FEATURE_FLAG_FORCE_ENABLE= line (or add the line)'
fi

# --- binaries --------------------------------------------------------------
echo "binaries:"
if command -v langy-worker >/dev/null 2>&1; then
  ok "langy-worker ($(command -v langy-worker))"
else
  bad "langy-worker not on PATH (the langyagent spawns it per conversation)"
  hint "cd services/langyworker && bun run scripts/build-binary.ts, then put out/langy-worker on PATH"
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
  hint "cd \"$ROOT/platform/app\" && pnpm dev   (or make -C \"$ROOT\" quickstart)"
fi
if listening "$GATEWAY_PORT"; then ok "AI gateway on :$GATEWAY_PORT"; else
  bad "AI gateway not listening on :$GATEWAY_PORT"
  hint "auto-starts with pnpm dev when Go is on PATH, or: make -C \"$ROOT\" service svc=aigateway"
fi
if listening "$AGENT_PORT"; then ok "langyagent on :$AGENT_PORT"; else
  bad "langyagent not listening on :$AGENT_PORT"
  hint "make -C \"$ROOT\" service svc=langyagent   (sources platform/app/.env; runs the no-sandbox dev runner)"
fi

# --- provider keys ---------------------------------------------------------
# Advisory: a rejected key fails turns with a distant mid-stream symptom, so
# name it here. A rejection does not fail the doctor, another provider's key
# may be the one in use.
echo "provider keys (advisory):"
check_key() {
  local name="$1" url="$2" header="$3" extra_header="${4:-}"
  local key
  key="$(env_value "$name")"
  if [[ -z "$key" ]]; then
    warn "$name not set"
    return
  fi
  # The secret header rides curl's config-from-stdin, never argv, so the key
  # is not observable in process listings.
  local -a curl_args=(-s -o /dev/null -w '%{http_code}' --max-time 10 --config - "$url")
  [[ -n "$extra_header" ]] && curl_args+=(-H "$extra_header")
  local code
  code="$(printf 'header = "%s%s"\n' "$header" "$key" | curl "${curl_args[@]}")"
  if [[ "$code" == "200" ]]; then
    ok "$name accepted by the provider"
  else
    warn "$name REJECTED by the provider (HTTP $code), turns on this provider will fail"
  fi
}
# The provider endpoints are overridable for tests, but only to LOOPBACK
# URLs: these checks send real credentials, and an inherited env var must not
# be able to redirect them off-machine. Proxy routing belongs to HTTPS_PROXY.
loopback_or() {
  local override="$1" fallback="$2"
  if [[ -z "$override" ]]; then
    printf '%s' "$fallback"
    return
  fi
  # Strict authority match: no userinfo, no other hosts. A glob like
  # http://localhost:* would also match http://localhost:123@attacker.example/
  # (userinfo), which sends the key off-machine.
  if [[ "$override" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(/.*)?$ ]]; then
    printf '%s' "$override"
    return
  fi
  warn "ignoring non-loopback endpoint override ($override); using the real provider endpoint" >&2
  printf '%s' "$fallback"
}
check_key OPENAI_API_KEY "$(loopback_or "${LANGY_DOCTOR_OPENAI_URL:-}" "https://api.openai.com/v1/models")" "Authorization: Bearer "
check_key ANTHROPIC_API_KEY "$(loopback_or "${LANGY_DOCTOR_ANTHROPIC_URL:-}" "https://api.anthropic.com/v1/models")" "x-api-key: " "anthropic-version: 2023-06-01"

# --- verdict ---------------------------------------------------------------
echo
if [[ $failures -eq 0 ]]; then
  echo "all checks passed, open http://localhost:${APP_PORT}, pick a model in the Langy composer, and ask it something"
  exit 0
fi
echo "$failures check(s) failed, fix the ✗ items above and re-run"
exit 1

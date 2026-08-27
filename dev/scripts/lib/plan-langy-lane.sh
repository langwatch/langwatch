#!/bin/bash
# Decide whether `pnpm dev` starts the Langy agent manager, and on which port.
#
# The decision has more branches than the other Go lanes, so it lives here
# rather than inline in start.sh: langyagent takes its listen port from PORT
# (which the launcher already uses for the app) and fails fast without its
# secret and its two roots, so a lane started into a setup that cannot run it
# restarts for as long as the stack is up.
#
# Usage from platform/app/scripts/start.sh:
#
#   . "$(dirname "$0")/../../../dev/scripts/lib/plan-langy-lane.sh"
#   plan_langy_lane "$(dirname "$0")/.." "$_APP_PORT"
#   # reads LANGY_LANE_DECISION, LANGY_LANE_REASON, LANGY_LANE_PORT
#
# See specs/setup/dev-langy-agent-lane.feature.

. "$(dirname "${BASH_SOURCE[0]}")/resolve-service-address.sh"

# The manager's own defaults are the production ones: twenty workers reaped
# after ten idle minutes. Each worker is about 600 MB, so on a laptop that is
# up to twelve gigabytes held for ten minutes after a chat ends. These are
# haven's local numbers for the same service.
LANGY_LOCAL_MAX_WORKERS=2
LANGY_LOCAL_WORKER_IDLE_MS=120000
LANGY_LOCAL_REAPER_INTERVAL_MS=2000

# The port slot the manager takes when nothing pins an address. The app is at
# PORT, the NLP engine at PORT+1 and the gateway at PORT+3, which leaves PORT+4
# free. It is also what the standalone server package defaults to.
LANGY_PORT_OFFSET=4

# Overridable so the lane can be planned in a test without a Go toolchain or a
# live listener.
_langy_have_go() { command -v go >/dev/null 2>&1; }
_langy_port_listening() { lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1; }

# True when the setting has a value in the shell or in either env file, which
# is what the manager will see: `make service` sources .env into its process.
_langy_setting_present() {
  local var="$1" app_dir="$2" file
  [ -n "${!var}" ] && return 0
  for file in "$app_dir/.env.portless" "$app_dir/.env"; do
    _service_address_from_env_file "$var" "$file" >/dev/null && return 0
  done
  return 1
}

_langy_skip() {
  LANGY_LANE_DECISION="skip"
  LANGY_LANE_REASON="$1"
}

plan_langy_lane() {
  local app_dir="${1:-.}"
  local app_port="${2:-5560}"

  LANGY_LANE_DECISION="skip"
  LANGY_LANE_REASON=""
  LANGY_LANE_PORT=""

  if [ "$LANGWATCH_SKIP_LANGY" = "1" ]; then
    _langy_skip "skipped (LANGWATCH_SKIP_LANGY=1)"
    return 0
  fi

  resolve_service_address OPENCODE_AGENT_URL "$app_dir" langy

  local port=""
  if [ -z "$OPENCODE_AGENT_URL" ]; then
    port=$((app_port + LANGY_PORT_OFFSET))
    export OPENCODE_AGENT_URL="http://localhost:${port}"
  elif [[ "$OPENCODE_AGENT_URL" =~ ^https?://(localhost|127\.0\.0\.1):([0-9]+) ]]; then
    port="${BASH_REMATCH[2]}"
  else
    _langy_skip "external OPENCODE_AGENT_URL=${OPENCODE_AGENT_URL}, not starting a local one"
    return 0
  fi
  LANGY_LANE_PORT="$port"

  # A manager that is already up answers for this stack too, so it is reused
  # before the setup is judged: a running service is proof the setup works.
  if _langy_port_listening "$port"; then
    _langy_skip "already running on :${port}, reusing"
    return 0
  fi

  if ! _langy_have_go; then
    _langy_skip "skipped (Go toolchain not in PATH); run \`make service svc=langyagent\` manually"
    return 0
  fi

  local var missing=""
  for var in LANGY_INTERNAL_SECRET SESSIONS_ROOT LANGY_WORKSPACE_ROOT; do
    if ! _langy_setting_present "$var" "$app_dir"; then
      missing="${missing:+$missing, }${var}"
    fi
  done
  if [ -n "$missing" ]; then
    _langy_skip "skipped (platform/app/.env has no ${missing}); run \`bash dev/scripts/dogfood/langy-local.sh\` for the block to paste"
    return 0
  fi

  LANGY_LANE_DECISION="start"
  LANGY_LANE_REASON="auto-start on :${port}"

  # The manager spawns this binary per conversation. Without it the manager
  # boots, accepts the dispatch and fails the turn with `exec: "langy-worker"`,
  # which reaches the reader as "Langy stopped mid-reply" and says nothing
  # about a missing build. Name the repo's copy and say when it is not there.
  LANGY_LANE_WORKER_BINARY="$(cd "$app_dir/../.." 2>/dev/null && pwd)/services/langyworker/out/langy-worker"
  if [ ! -x "$LANGY_LANE_WORKER_BINARY" ]; then
    LANGY_LANE_REASON="${LANGY_LANE_REASON}, chats need \`pnpm --filter @langwatch/langyworker build:binary\` first"
  fi
  return 0
}

# The command the lane runs. Every cap is applied only when the developer has
# not set one, so a pinned value in the environment still wins.
langy_lane_command() {
  local repo_from_app="$1"
  local port="$2"
  printf '%s' "PORT=\"${port}\" \
LANGY_PI_WORKER_BINARY_PATH=\"\${LANGY_PI_WORKER_BINARY_PATH:-${LANGY_LANE_WORKER_BINARY}}\" \
LANGY_MAX_WORKERS=\"\${LANGY_MAX_WORKERS:-${LANGY_LOCAL_MAX_WORKERS}}\" \
LANGY_WORKER_IDLE_MS=\"\${LANGY_WORKER_IDLE_MS:-${LANGY_LOCAL_WORKER_IDLE_MS}}\" \
LANGY_REAPER_INTERVAL_MS=\"\${LANGY_REAPER_INTERVAL_MS:-${LANGY_LOCAL_REAPER_INTERVAL_MS}}\" \
make -C ${repo_from_app} service svc=langyagent"
}

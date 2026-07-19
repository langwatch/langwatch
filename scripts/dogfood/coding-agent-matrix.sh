#!/usr/bin/env bash
# Drive real coding agents (claude / codex / opencode / gemini) in interactive
# tmux sessions with their LangWatch OTLP telemetry wired to a running
# instance, so the coding-agent telemetry path can be verified end to end ,
# including the nested shape where an outer claude session spawns child agent
# sessions itself.
#
# The per-agent env blocks MIRROR the CLI wrapper's buildOtelEnvBlock
# (typescript-sdk/src/cli/utils/governance/wrapper-mode.ts). If the wrapper
# gains a knob, add it here too, this script exists to test what the wrapper
# ships, not a private variant.
#
# Usage:
#   LW_API_KEY=sk-lw-... scripts/dogfood/coding-agent-matrix.sh up claude
#   scripts/dogfood/coding-agent-matrix.sh send claude 'say hi and exit'
#   scripts/dogfood/coding-agent-matrix.sh drive-nested   # outer claude spawns children
#   scripts/dogfood/coding-agent-matrix.sh capture claude
#   scripts/dogfood/coding-agent-matrix.sh down
#
# Env:
#   LW_ENDPOINT  OTLP base (default http://localhost:5560/api/otel)
#   LW_API_KEY   project API key used as the Bearer token (required)
#   CAM_PREFIX   tmux session name prefix (default cam)
set -euo pipefail

ENDPOINT="${LW_ENDPOINT:-http://localhost:5560/api/otel}"
PREFIX="${CAM_PREFIX:-cam}"
ENV_DIR="${TMPDIR:-/tmp}/coding-agent-matrix-env"
# Claude sessions run out of this scratch workdir: claude applies the `env`
# block of ~/.claude/settings.json ON TOP of the process environment, so a
# machine with a previous `langwatch claude` install silently re-routes the
# shell-exported OTLP wiring to whatever endpoint that install configured
# (usually prod). Project-level settings take precedence over user-level, so
# a .claude/settings.local.json in the cwd pins the wiring without touching
# the operator's global config.
WORK_DIR="${TMPDIR:-/tmp}/coding-agent-matrix-work"
mkdir -p "$ENV_DIR" "$WORK_DIR"

require_key() {
  : "${LW_API_KEY:?LW_API_KEY (project API key) is required}"
}

# One sourceable env file per agent. Children started from inside an agent
# session must `source` these explicitly: tmux new-session inherits the tmux
# SERVER environment, not the calling pane's exports, so relying on
# inheritance silently strips the telemetry wiring from every child.
write_env_file() {
  local agent="$1"
  local f="$ENV_DIR/$agent.sh"
  {
    echo "export OTEL_EXPORTER_OTLP_ENDPOINT='$ENDPOINT'"
    echo "export OTEL_EXPORTER_OTLP_HEADERS='Authorization=Bearer $LW_API_KEY'"
    case "$agent" in
      claude)
        cat <<'CLAUDE_ENV'
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
export OTEL_TRACES_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_LOG_USER_PROMPTS=1
export OTEL_LOG_TOOL_DETAILS=1
export OTEL_LOG_TOOL_CONTENT=1
export OTEL_LOG_RAW_API_BODIES=1
export OTEL_RESOURCE_ATTRIBUTES=service.name=claude-code
# Fast flush so a short dogfood session lands before the operator gets bored.
export OTEL_METRIC_EXPORT_INTERVAL=5000
export OTEL_LOGS_EXPORT_INTERVAL=3000
CLAUDE_ENV
        ;;
      codex)
        cat <<'CODEX_ENV'
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_RESOURCE_ATTRIBUTES=service.name=codex
CODEX_ENV
        ;;
      opencode)
        cat <<'OPENCODE_ENV'
export OTEL_TRACES_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_RESOURCE_ATTRIBUTES=service.name=opencode
OPENCODE_ENV
        ;;
      gemini)
        cat <<GEMINI_ENV
export GEMINI_TELEMETRY_ENABLED=true
export GEMINI_TELEMETRY_TARGET=local
export GEMINI_TELEMETRY_USE_COLLECTOR=true
export GEMINI_TELEMETRY_TRACES_ENABLED=true
export GEMINI_TELEMETRY_OTLP_PROTOCOL=http
export GEMINI_TELEMETRY_OTLP_ENDPOINT='$ENDPOINT'
export GEMINI_TELEMETRY_LOG_PROMPTS=true
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_RESOURCE_ATTRIBUTES=service.name=gemini-cli
GEMINI_ENV
        ;;
      *)
        echo "unknown agent: $agent" >&2
        exit 1
        ;;
    esac
  } >"$f"
  echo "$f"
}

agent_command() {
  case "$1" in
    claude) echo "claude --dangerously-skip-permissions" ;;
    codex) echo "codex --dangerously-bypass-approvals-and-sandbox" ;;
    opencode) echo "opencode" ;;
    gemini) echo "gemini --yolo" ;;
    *) echo "unknown agent: $1" >&2; exit 1 ;;
  esac
}

# Pin the claude telemetry wiring at project-settings level (see WORK_DIR
# note above). The JSON mirrors the claude case of write_env_file.
write_claude_workdir() {
  mkdir -p "$WORK_DIR/.claude"
  cat >"$WORK_DIR/.claude/settings.local.json" <<SETTINGS
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_LOG_USER_PROMPTS": "1",
    "OTEL_LOG_TOOL_DETAILS": "1",
    "OTEL_LOG_TOOL_CONTENT": "1",
    "OTEL_LOG_RAW_API_BODIES": "1",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "$ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer $LW_API_KEY",
    "OTEL_RESOURCE_ATTRIBUTES": "service.name=claude-code",
    "OTEL_METRIC_EXPORT_INTERVAL": "5000",
    "OTEL_LOGS_EXPORT_INTERVAL": "3000"
  }
}
SETTINGS
}

session_name() { echo "$PREFIX-$1"; }

cmd_up() {
  require_key
  local agent="$1"
  local env_file session start_dir
  env_file="$(write_env_file "$agent")"
  session="$(session_name "$agent")"
  start_dir="$PWD"
  if [ "$agent" = "claude" ]; then
    write_claude_workdir
    start_dir="$WORK_DIR"
  fi
  tmux kill-session -t "$session" 2>/dev/null || true
  tmux new-session -d -s "$session" -c "$start_dir" \
    "source '$env_file' && $(agent_command "$agent")"
  echo "up: $session (env: $env_file, cwd: $start_dir)"
}

cmd_send() {
  local agent="$1"; shift
  tmux send-keys -t "$(session_name "$agent")" "$*"
  sleep 1
  tmux send-keys -t "$(session_name "$agent")" Enter
}

cmd_capture() {
  tmux capture-pane -p -t "$(session_name "$1")"
}

cmd_down() {
  local s
  for s in $(tmux list-sessions -F '#S' 2>/dev/null | grep "^$PREFIX-" || true); do
    tmux kill-session -t "$s"
    echo "killed: $s"
  done
}

# The nested shape: one OUTER claude session is told to spawn child agent
# sessions itself (claude, codex, opencode), each sourcing its own env file so
# its telemetry reaches the same project. This is the scenario that exercises
# subagent spans AND multi-agent ingest in one go.
cmd_drive_nested() {
  require_key
  local agent
  for agent in claude codex opencode; do
    write_env_file "$agent" >/dev/null
  done
  cmd_up claude
  sleep 8
  # Children are INTERACTIVE sessions the outer claude drives via send-keys,
  # mirroring how a human runs them, one-shot print/exec modes take
  # different telemetry paths and would test the wrong thing.
  cmd_send claude "You are in a telemetry dogfood run. Do exactly this, step by step, and be brief. 1) Use your Task tool to run one subagent that computes 17*23. 2) Start three INTERACTIVE child agent sessions: tmux new-session -d -s cam-child-claude -c $WORK_DIR \"source $ENV_DIR/claude.sh && claude --dangerously-skip-permissions\" ; tmux new-session -d -s cam-child-codex \"source $ENV_DIR/codex.sh && codex --dangerously-bypass-approvals-and-sandbox\" ; tmux new-session -d -s cam-child-opencode \"source $ENV_DIR/opencode.sh && opencode\". 3) Wait 15 seconds for them to boot, then type into each with tmux send-keys (text first, then a separate send-keys Enter after a 1s pause): ask each to reply with the single word pong. 4) Wait 30 seconds, capture each pane with tmux capture-pane -p -t <session> to confirm each replied. 5) Exit each child cleanly: send /exit to cam-child-claude and cam-child-codex the same send-keys way, and send C-c then C-d to cam-child-opencode if it has no /exit. 6) Report which children replied and which exited. Then you are done."
  echo "nested drive started; watch with: $0 capture claude"
}

case "${1:-help}" in
  up) shift; cmd_up "$@" ;;
  send) shift; cmd_send "$@" ;;
  capture) shift; cmd_capture "$@" ;;
  down) cmd_down ;;
  drive-nested) cmd_drive_nested ;;
  env) shift; require_key; write_env_file "$1" ;;
  *)
    sed -n '2,20p' "$0"
    ;;
esac

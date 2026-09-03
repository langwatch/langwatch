#!/bin/bash
# Pre-flight port check for `pnpm dev`.
#
# `pnpm dev` runs three applications, so it holds three ports:
#   - PORT          (5560) apps/ui      — the browser application (Vite)
#   - PORT + 1000   (6560) apps/api     — tRPC + REST + SSE
#   - PORT - 2561   (2999) apps/worker  — the worker's metrics/healthz listener
#
# Every one of them is reserved: each is a separate process now, so there is
# no topology in which one of the three is absent. The gateway sits at PORT + 3
# (5563) and is deliberately not reserved — see below.
#
# Picking PORT in increments of 10 (5570, 5580, …) keeps room for the
# adjacent NLP / langevals services that already sit on 5561 / 5562.

# Intentionally NOT using `set -e` / `pipefail`: `lsof -tiTCP:N` exits 1 when
# the port is free, which is the *good* path for us — it should not abort
# the whole script.

# This pre-flight check is a dev-host-only quality-of-life affordance: it
# catches the common case where two `pnpm dev` invocations on the same laptop
# fight for the same ports. In any other context it's pointless noise:
#   - Production: if the port is taken the process will fail to bind and
#     surface its own clean error — we must not fail-fast the container start.
#   - Docker: each container has its own network namespace, so collisions are
#     impossible by definition, and `lsof` inside a distroless-ish image can
#     misreport PID 1 (the node entrypoint itself) as holding the port.
if [ "${NODE_ENV:-production}" != "development" ] || [ -f /.dockerenv ]; then
  exit 0
fi

# The same derivation the launcher hands to the lanes, so the ports reserved
# here and the ports bound there can never disagree.
# shellcheck source=./lib/derive-dev-ports.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/derive-dev-ports.sh"
derive_dev_ports

PORT="$APP_PORT"

PORTS_TO_CHECK=("$PORT" "$API_PORT" "$WORKER_METRICS_PORT")
PORT_LABELS=("ui — the browser application" "api" "worker metrics")

# The AI Gateway port (PORT + 3) is intentionally not flagged here: the
# gateway autostart reuses an existing listener on that port (another
# worktree's gateway, or a manual `make service` run) rather than failing, so
# a busy gateway port is a normal path, not a conflict. The suggested-slot
# search below does not gate on it either, for the same reason.

# `lsof -tiTCP:N -sTCP:LISTEN` prints PIDs (one per line) holding port N.
port_holder() {
  lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
}

port_holder_command() {
  local pid="$1"
  ps -o command= -p "$pid" 2>/dev/null | sed 's/  */ /g' | cut -c1-100
}

conflicts=()
for i in "${!PORTS_TO_CHECK[@]}"; do
  port="${PORTS_TO_CHECK[$i]}"
  label="${PORT_LABELS[$i]}"
  pid=$(port_holder "$port")
  if [ -n "$pid" ]; then
    conflicts+=("$port|$label|$pid")
  fi
done

if [ "${#conflicts[@]}" -eq 0 ]; then
  exit 0
fi

# Find the next free PORT slot in increments of 10. All three ports have to be
# free for a slot to be usable, because all three are always bound.
suggested_port=""
slot="$PORT"
for _ in $(seq 1 30); do
  slot=$((slot + 10))
  if [ -z "$(port_holder "$slot")" ] &&
    [ -z "$(port_holder "$((slot + 1000))")" ] &&
    [ -z "$(port_holder "$((slot - 2561))")" ]; then
    suggested_port="$slot"
    break
  fi
done

# ANSI colors (skip if NO_COLOR or non-tty)
if [ -t 1 ] && [ -z "$NO_COLOR" ]; then
  RED=$'\033[0;31m'
  YEL=$'\033[0;33m'
  CYA=$'\033[0;36m'
  BLD=$'\033[1m'
  RST=$'\033[0m'
else
  RED=""
  YEL=""
  CYA=""
  BLD=""
  RST=""
fi

echo ""
echo "${RED}${BLD}✗ port conflict — refusing to start${RST}"
echo ""
for c in "${conflicts[@]}"; do
  port="${c%%|*}"
  rest="${c#*|}"
  label="${rest%%|*}"
  pid="${rest#*|}"
  cmd="$(port_holder_command "$pid")"
  echo "  ${RED}✗${RST} port ${BLD}${port}${RST} (${label}) held by pid ${pid}: ${cmd}"
done
echo ""
echo "${YEL}${BLD}options:${RST}"
echo ""
if [ -n "$suggested_port" ]; then
  echo "  ${CYA}1)${RST} use a free port slot (ui=${suggested_port}, api=$((suggested_port + 1000)), metrics=$((suggested_port - 2561))):"
  echo ""
  echo "       ${BLD}PORT=${suggested_port} pnpm dev${RST}"
  echo ""
fi
# Target exactly the ports we actually check, so the kill never sweeps
# whatever happens to live on a port this topology does not bind.
PORT_LIST_CSV=$(
  IFS=,
  echo "${PORTS_TO_CHECK[*]}"
)
echo "  ${CYA}2)${RST} kill the existing langwatch dev tree (safe — only kills node procs holding our ports, leaves Docker etc alone):"
echo ""
echo "       ${BLD}bash $(dirname "$0")/kill-dev-tree.sh ${PORT_LIST_CSV}${RST}"
echo ""

exit 1

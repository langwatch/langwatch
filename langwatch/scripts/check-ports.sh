#!/bin/bash
# Pre-flight port check for `pnpm dev` / `pnpm start`.
#
# Default port layout (PORT=5560):
#   - PORT          (5560) Vite dev server (frontend)
#   - PORT + 1000   (6560) API / Hono backend
#   - PORT - 2561   (2999) Worker metrics
#
# Picking PORT in increments of 10 (5570, 5580, …) keeps room for the
# adjacent NLP / langevals services that already sit on 5561 / 5562.

# Intentionally NOT using `set -e` / `pipefail`: `lsof -tiTCP:N` exits 1 when
# the port is free, which is the *good* path for us — it should not abort
# the whole script.

# This pre-flight check is a dev-host-only quality-of-life affordance: it
# catches the common case where two `pnpm dev` invocations on the same laptop
# fight for the same ports. In any other context it's pointless noise:
#   - Production: if the port is taken the node server will fail to bind and
#     surface its own clean error — we must not fail-fast the container start.
#   - Docker: each container has its own network namespace, so collisions are
#     impossible by definition, and `lsof` inside a distroless-ish image can
#     misreport PID 1 (the node entrypoint itself) as holding the port.
if [ "${NODE_ENV:-production}" != "development" ] || [ -f /.dockerenv ]; then
  exit 0
fi

PORT="${PORT:-5560}"
API_PORT=$((PORT + 1000))
WORKER_METRICS_PORT="${WORKER_METRICS_PORT:-$((PORT - 2561))}"

NODE_ENV_VAL="${NODE_ENV:-production}"
START_WORKERS_VAL="${START_WORKERS:-false}"

PORTS_TO_CHECK=()
PORT_LABELS=()

if [ "$NODE_ENV_VAL" = "development" ]; then
  PORTS_TO_CHECK+=("$PORT")          ; PORT_LABELS+=("vite frontend")
  PORTS_TO_CHECK+=("$API_PORT")      ; PORT_LABELS+=("api backend")
else
  PORTS_TO_CHECK+=("$PORT")          ; PORT_LABELS+=("api server")
fi

if [ "$START_WORKERS_VAL" = "true" ] || [ "$START_WORKERS_VAL" = "1" ]; then
  PORTS_TO_CHECK+=("$WORKER_METRICS_PORT") ; PORT_LABELS+=("worker metrics")
fi

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

# Find the next free PORT slot in increments of 10. We need ALL three derived
# ports (slot, slot+1000, slot-2561) free.
suggested_port=""
slot="$PORT"
for _ in $(seq 1 30); do
  slot=$((slot + 10))
  vite_p="$slot"
  api_p=$((slot + 1000))
  metrics_p=$((slot - 2561))
  if [ -z "$(port_holder "$vite_p")" ] && \
     [ -z "$(port_holder "$api_p")" ] && \
     [ -z "$(port_holder "$metrics_p")" ]; then
    suggested_port="$slot"
    break
  fi
done

# ANSI colors (skip if NO_COLOR or non-tty)
if [ -t 1 ] && [ -z "$NO_COLOR" ]; then
  RED=$'\033[0;31m'; YEL=$'\033[0;33m'; CYA=$'\033[0;36m'; BLD=$'\033[1m'; RST=$'\033[0m'
else
  RED=""; YEL=""; CYA=""; BLD=""; RST=""
fi

echo ""
echo "${RED}${BLD}✗ port conflict — refusing to start${RST}"
echo ""
for c in "${conflicts[@]}"; do
  port="${c%%|*}"; rest="${c#*|}"
  label="${rest%%|*}"; pid="${rest#*|}"
  cmd="$(port_holder_command "$pid")"
  echo "  ${RED}✗${RST} port ${BLD}${port}${RST} (${label}) held by pid ${pid}: ${cmd}"
done
echo ""
echo "${YEL}${BLD}options:${RST}"
echo ""
if [ -n "$suggested_port" ]; then
  echo "  ${CYA}1)${RST} use a free port slot (vite=${suggested_port}, api=$((suggested_port + 1000)), metrics=$((suggested_port - 2561))):"
  echo ""
  echo "       ${BLD}PORT=${suggested_port} pnpm dev${RST}"
  echo ""
fi
# Target exactly the ports we actually check — so if workers aren't enabled,
# the kill doesn't sweep whatever happens to live on PORT - 2561.
PORT_LIST_CSV=$(IFS=,; echo "${PORTS_TO_CHECK[*]}")
echo "  ${CYA}2)${RST} kill the existing langwatch dev tree (safe — only kills node procs holding our ports, leaves Docker etc alone):"
echo ""
echo "       ${BLD}lsof -t -a -iTCP:${PORT_LIST_CSV} -sTCP:LISTEN -c node 2>/dev/null \\"
echo "         | xargs -I{} ps -o pgid= -p {} 2>/dev/null | tr -d ' ' | sort -u \\"
echo "         | xargs -I{} kill -TERM -{}${RST}"
echo ""

exit 1

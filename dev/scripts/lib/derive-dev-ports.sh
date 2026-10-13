#!/bin/bash
# The one derivation of the dev stack's ports.
#
#   . dev/scripts/lib/derive-dev-ports.sh
#   derive_dev_ports
#
# Sets, and EXPORTS, the port each lane binds:
#
#   APP_PORT             PORT, default 5560   apps/ui      (Vite)
#   API_PORT             PORT + 1000          apps/api     (tRPC + REST + SSE)
#   WORKER_METRICS_PORT  PORT - 2561          apps/worker  (metrics/healthz)
#   GATEWAY_PORT         PORT + 3             services/aigateway
#
# Exporting is the whole point, and it is what was missing. `pnpm dev` derived
# the api lane's port and kept it in the launcher's own shell, so the api
# process fell through its API_PORT / LANGWATCH_API_PORT / PORT precedence to
# PORT — the browser application's — read out of the workspace `.env`, and died
# on boot with `EADDRINUSE 0.0.0.0:5560`. Everything downstream then read as a
# different fault: every Vite proxy attempt was an ECONNREFUSED stack, and the
# gateway reported the control plane unreachable.
#
# Why export rather than pass per lane: the Node lanes load the workspace env
# files themselves, with `--env-file-if-exists`, which never overwrites a
# variable that is ALREADY SET in the process environment. So an exported value
# beats the committed one, and a value merely set in this shell does not reach
# the lane at all.
#
# Each variable is derived only when it is unset or empty, so a developer who
# set one themselves keeps it, and the pre-flight that reserves the ports and
# the launcher that hands them out can never disagree about which port a lane
# gets.

derive_dev_ports() {
  APP_PORT="${PORT:-5560}"

  if [ -z "${API_PORT:-}" ]; then
    API_PORT=$((APP_PORT + 1000))
  fi
  if [ -z "${WORKER_METRICS_PORT:-}" ]; then
    WORKER_METRICS_PORT=$((APP_PORT - 2561))
  fi
  if [ -z "${GATEWAY_PORT:-}" ]; then
    GATEWAY_PORT=$((APP_PORT + 3))
  fi

  export API_PORT
  export WORKER_METRICS_PORT
  export GATEWAY_PORT
}

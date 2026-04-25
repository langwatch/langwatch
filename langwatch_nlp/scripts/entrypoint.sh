#!/bin/sh
#
# Entrypoint for the langwatch_nlp container. Implements the parallel-
# deployment scheme from specs/nlp-go/_shared/contract.md §3:
#
#   default: nlpgo (Go) is the front door at $PORT; spawns uvicorn as a
#            child on 127.0.0.1:5561; routes /go/* itself, reverse-
#            proxies everything else to uvicorn.
#
#   NLPGO_BYPASS=1: emergency lever — skip nlpgo entirely and run uvicorn
#                   directly on $PORT. Same external surface, no Go in
#                   the path. Use this when nlpgo has a regression and
#                   we need to fail back instantly without infra changes.
#
# PORT defaults to 8080 (Lambda Adapter expectation). Dev/k8s callers can
# override (5562 on a pod, etc.).

set -e

PORT="${PORT:-8080}"
KEEP_ALIVE="${NLP_UVICORN_KEEP_ALIVE_SECONDS:-4500}"

run_uvicorn_only() {
  exec uv --no-cache run --no-sync --no-editable uvicorn langwatch_nlp.main:app \
    --host 0.0.0.0 --port "$1" \
    --timeout-keep-alive "$KEEP_ALIVE"
}

if [ "${NLPGO_BYPASS:-0}" = "1" ]; then
  echo "[entrypoint] NLPGO_BYPASS=1 — running uvicorn directly on :$PORT"
  run_uvicorn_only "$PORT"
fi

if [ ! -x /usr/local/bin/nlpgo ]; then
  echo "[entrypoint] nlpgo binary missing — falling back to uvicorn on :$PORT"
  run_uvicorn_only "$PORT"
fi

# nlpgo binds $PORT and spawns uvicorn at 127.0.0.1:5561 as its child.
# Configure via SERVER_ADDR (parent) and NLPGO_CHILD_* (uvicorn args).
export SERVER_ADDR=":$PORT"
export NLPGO_CHILD_COMMAND="${NLPGO_CHILD_COMMAND:-uv}"
export NLPGO_CHILD_ARGS="${NLPGO_CHILD_ARGS:---no-cache,run,--no-sync,--no-editable,uvicorn,langwatch_nlp.main:app,--host,127.0.0.1,--port,5561,--timeout-keep-alive,$KEEP_ALIVE}"
export NLPGO_CHILD_HEALTH_URL="${NLPGO_CHILD_HEALTH_URL:-http://127.0.0.1:5561/health}"
export NLPGO_CHILD_UPSTREAM_URL="${NLPGO_CHILD_UPSTREAM_URL:-http://127.0.0.1:5561}"

echo "[entrypoint] nlpgo (Go) on :$PORT — uvicorn child on 127.0.0.1:5561"
exec /usr/local/bin/nlpgo

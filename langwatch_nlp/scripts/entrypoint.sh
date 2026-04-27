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

# Bypass-mode invocation is env-overridable so the saas runtime images
# (Dockerfile.langwatch_nlp.{service,lambda}.runtime in langwatch-saas)
# can use `python -m uvicorn` instead of `uv run uvicorn` — those images
# don't ship `uv` in the runtime stage to keep the layer lean. The
# monorepo lambda image ships uv (it builds with `uv build` in the same
# image), so the defaults match its shape.
BYPASS_COMMAND="${NLPGO_BYPASS_COMMAND:-uv}"
BYPASS_ARGS="${NLPGO_BYPASS_ARGS:---no-cache run --no-sync --no-editable uvicorn langwatch_nlp.main:app --host 0.0.0.0 --timeout-keep-alive $KEEP_ALIVE}"

run_uvicorn_only() {
  # The bypass invocation appends --port LAST so the args set above don't
  # have to know what port to bind — the entrypoint owns that.
  # shellcheck disable=SC2086 # word-splitting is intentional here
  exec $BYPASS_COMMAND $BYPASS_ARGS --port "$1"
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
# Space-separated, NOT comma-separated: services/nlpgo/deps.go's
# splitArgs() splits on space/tab. Original entrypoint shipped commas
# (a4de2dc95) which silently broke the uvicorn child on every container
# start — uv would see "--no-cache,run,..." as a single positional
# argument and exit 2 before serving anything. Caught smoke-testing
# the lambda image during the PR #3483 deploy pre-flight: nlpgo started
# fine, /go/* worked, but the child never came up so anything that
# fell through to legacy /studio/* /api/* paths got 502. Anchored on
# spaces here to match the deps.go contract.
export NLPGO_CHILD_ARGS="${NLPGO_CHILD_ARGS:---no-cache run --no-sync --no-editable uvicorn langwatch_nlp.main:app --host 127.0.0.1 --port 5561 --timeout-keep-alive $KEEP_ALIVE}"
export NLPGO_CHILD_HEALTH_URL="${NLPGO_CHILD_HEALTH_URL:-http://127.0.0.1:5561/health}"
export NLPGO_CHILD_UPSTREAM_URL="${NLPGO_CHILD_UPSTREAM_URL:-http://127.0.0.1:5561}"

echo "[entrypoint] nlpgo (Go) on :$PORT — uvicorn child on 127.0.0.1:5561"
exec /usr/local/bin/nlpgo

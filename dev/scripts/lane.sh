#!/bin/bash
# Runs one `pnpm dev` lane with its output rendered by the shared log renderer.
#
#   dev/scripts/lane.sh <lane-name> <command…>
#
# Every lane writes the shared structured JSON (see
# dev/docs/best_practices/dev-log-format.md); this puts a person's rendering in
# front of it, the same one `haven logs` uses, so the plain path and the haven
# path read identically.
#
# `pipefail` is the load-bearing part. Without it the pipeline's status is the
# renderer's — always 0 — and `concurrently --kill-others-on-fail` would never
# see a lane die. concurrently spawns each command through /bin/sh, which is
# not required to have `pipefail`, so the lane is wrapped in bash here rather
# than pipefail being set in the command string.
set -o pipefail

LANE="$1"
shift

if [ -z "$LANE" ] || [ "$#" -eq 0 ]; then
  echo "usage: dev/scripts/lane.sh <lane-name> <command...>" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"

# LANGWATCH_RAW_LOGS=1 is the escape hatch: the lane's own bytes, unrendered,
# for when the renderer itself is what is being doubted.
if [ "${LANGWATCH_RAW_LOGS:-}" = "1" ]; then
  exec bash -c "$*"
fi

# LANGWATCH_LANE tells anything nested (notably `make service`, which renders
# for its own standalone users) that a renderer is already in front of it.
export LANGWATCH_LANE="$LANE"

bash -c "$*" 2>&1 | node "$HERE/log-render.mjs" "$LANE" --color

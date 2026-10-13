#!/usr/bin/env bash
# Runs one experiment SDK cell (log_steps or compare) with the in-repo Python SDK against
# this worktree's haven stack, every model call answered by llmsim (`haven up +llm`).
# compare also needs langevals. dspy<3.4: the SDK's LM patch breaks on 3.4. Usage: ./run.sh log_steps|compare
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
CELL="${1:?usage: run.sh log_steps|compare}"

eval "$(cd "$ROOT" && haven env --reveal | grep -E '^export (LANGWATCH_ENDPOINT|HAVEN_SEED_LANGWATCH_API_KEY)=')"
export LANGWATCH_API_KEY="$HAVEN_SEED_LANGWATCH_API_KEY"
export LLMSIM_BASE_URL="${LANGWATCH_ENDPOINT/\/\/app./\/\/llm.}/v1"

cd "$HERE"
exec uv run --no-project --python 3.12 --with "langwatch[dspy] @ $ROOT/sdks/python" --with truststore \
  --with "dspy<3.4" \
  python "$CELL.py"

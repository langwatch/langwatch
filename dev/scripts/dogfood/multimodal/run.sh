#!/usr/bin/env bash
# Runs every multimodal dogfood cell in order. Each cell prints its own
# report line (the question answer, truncated) followed by a plain
# OK/FAILED summary line. A cell that fails does not stop the rest.
#
# Required environment, see README.md for the full list:
#   LANGWATCH_ENDPOINT, LANGWATCH_API_KEY
#   OPENAI_BASE_URL, OPENAI_API_KEY
#   ANTHROPIC_API_KEY
#   AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY
#   GEMINI_API_KEY
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION
#
# Usage:
#   ./run.sh

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$HERE/python"
TS="$HERE/typescript"

if [ -z "${LANGWATCH_ENDPOINT:-}" ] || [ -z "${LANGWATCH_API_KEY:-}" ]; then
  echo "missing environment: LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set" >&2
  exit 1
fi

run_cell() {
  local label="$1"
  local cmd="$2"
  echo "--- $label ---"
  if (eval "$cmd"); then
    echo "RESULT $label OK"
  else
    local code=$?
    echo "RESULT $label FAILED (exit $code)"
  fi
}

run_cell "openai-python/image" "cd '$PY' && uv run --with langwatch --with openai python openai_official.py image"
run_cell "openai-python/pdf" "cd '$PY' && uv run --with langwatch --with openai python openai_official.py pdf"

run_cell "anthropic-python/image" "cd '$PY' && uv run --with langwatch --with anthropic --with openinference-instrumentation-anthropic python anthropic_official.py image"
run_cell "anthropic-python/pdf" "cd '$PY' && uv run --with langwatch --with anthropic --with openinference-instrumentation-anthropic python anthropic_official.py pdf"

run_cell "azure-openai/image" "cd '$PY' && uv run --with langwatch --with openai python azure_openai.py"

run_cell "google-adk/image" "cd '$PY' && uv run --with langwatch --with google-adk --with 'openinference-instrumentation-google-adk>=0.1.11' python google_adk.py image"
run_cell "google-adk/pdf" "cd '$PY' && uv run --with langwatch --with google-adk --with 'openinference-instrumentation-google-adk>=0.1.11' python google_adk.py pdf"

run_cell "langgraph-openai/image" "cd '$PY' && uv run --with langwatch --with langchain --with langgraph --with langchain-openai python langgraph_openai.py"

run_cell "strands-bedrock/image" "cd '$PY' && uv run --with langwatch --with strands-agents python strands_bedrock.py image"
run_cell "strands-bedrock/pdf" "cd '$PY' && uv run --with langwatch --with strands-agents python strands_bedrock.py pdf"

run_cell "vercel-ai/image" "cd '$TS' && npm install --no-fund --no-audit --silent && node vercel-ai.ts image"
run_cell "vercel-ai/pdf" "cd '$TS' && node vercel-ai.ts pdf"

echo "all cells finished"

#!/usr/bin/env bash
# F-matrix probe — smoke-test each provider × VK scope through the Go
# gateway. Prints a markdown table the PR description can absorb directly.
#
# Usage:
#   LW_GATEWAY_BASE_URL=http://localhost:5563 \
#   VK_ORG=vk-lw-... \
#   VK_TEAM=vk-lw-... \
#   VK_PROJECT=vk-lw-... \
#   VK_PERSONAL=vk-lw-... \
#   scripts/_dogfood_matrix_probe.sh
#
# Set provider keys on the seeded MPs first (via the UI Advanced tab, or
# directly in the DB); cells where the underlying MP has no API key will
# come back as `503 provider_keys_missing` — that's still a useful signal
# that the wire path resolved cleanly.

set -euo pipefail

GATEWAY="${LW_GATEWAY_BASE_URL:-http://localhost:5563}"

declare -a SCOPES=("ORG" "TEAM" "PROJECT" "PERSONAL")
declare -a PROVIDERS=("openai" "anthropic" "gemini" "bedrock")

# Smallest / cheapest model per provider.
declare -A MODEL=(
  [openai]="gpt-5-mini"
  [anthropic]="claude-haiku-4-5"
  [gemini]="gemini-2.5-flash"
  [bedrock]="bedrock/qwen.qwen3-32b-v1:0"
)

# OpenAI gpt-5-* family rejects max_tokens; uses max_completion_tokens.
# Anthropic + Gemini + Bedrock keep max_tokens.
declare -A TOKEN_FIELD=(
  [openai]="max_completion_tokens"
  [anthropic]="max_tokens"
  [gemini]="max_tokens"
  [bedrock]="max_tokens"
)

vk_for_scope() {
  case "$1" in
    ORG) echo "${VK_ORG:-}" ;;
    TEAM) echo "${VK_TEAM:-}" ;;
    PROJECT) echo "${VK_PROJECT:-}" ;;
    PERSONAL) echo "${VK_PERSONAL:-}" ;;
  esac
}

probe() {
  local scope="$1"
  local provider="$2"
  local vk
  vk="$(vk_for_scope "$scope")"
  if [ -z "$vk" ]; then
    echo "MISSING_VK"
    return
  fi
  local model="${MODEL[$provider]}"
  local token_field="${TOKEN_FIELD[$provider]:-max_tokens}"
  local body
  body=$(cat <<JSON
{"model":"${model}","messages":[{"role":"user","content":"ping"}],"${token_field}":8,"stream":false}
JSON
)
  local start_ms end_ms code
  start_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o /tmp/_dogfood_matrix.out -w "%{http_code}" --max-time 20 \
    -X POST "${GATEWAY}/v1/chat/completions" \
    -H "Authorization: Bearer ${vk}" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null || echo "000")
  end_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
  local dur=$((end_ms - start_ms))
  if [ "$code" = "200" ]; then
    echo "✓ 200/${dur}ms"
  else
    local short
    short=$(jq -r '.error.code // .error.type // "?"' < /tmp/_dogfood_matrix.out 2>/dev/null || echo "?")
    echo "✗ ${code}/${dur}ms (${short})"
  fi
}

main() {
  echo "Probing ${GATEWAY} (set LW_GATEWAY_BASE_URL to override)"
  echo

  printf "| Provider \\\\ Scope |"
  for s in "${SCOPES[@]}"; do printf " %-10s |" "$s"; done
  printf "\n|---|"
  for _ in "${SCOPES[@]}"; do printf "%s" "---|"; done
  printf "\n"

  for p in "${PROVIDERS[@]}"; do
    printf "| **%-10s** |" "$p"
    for s in "${SCOPES[@]}"; do
      local result
      result=$(probe "$s" "$p")
      printf " %-10s |" "$result"
    done
    printf "\n"
  done
}

main

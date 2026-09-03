#!/bin/bash
# Resolve the NLP engine address the app is going to dial, so `pnpm dev` starts
# its engine on that port instead of one nothing talks to.
#
# dev/scripts/dev-stack.sh runs before any Node entry point, and the shell never
# loads .env. The applications do, with `override: true`, so a
# LANGWATCH_NLP_SERVICE pinned in .env is the address the api lane dials and the
# launcher cannot see it. Without this the launcher reads an unset variable,
# derives PORT+1, starts an engine there, and every optimization-studio or
# playground run fails with "LangWatch NLP is unreachable" while a healthy
# engine sits on the other port.
#
# Precedence mirrors the applications' own load order, because the goal is to
# predict what they will resolve: .env.portless (the haven overlay, loaded last)
# beats .env, and both beat the calling shell. Leaving the variable untouched
# means nothing pinned an address, which is the launcher's cue to derive PORT+1
# and point the api lane at it.
#
# Usage from dev/scripts/dev-stack.sh:
#
#   . "$(dirname "$0")/lib/resolve-nlp-service.sh"
#   resolve_nlp_service "$REPO_ROOT"

# Reads LANGWATCH_NLP_SERVICE out of one env file the way dotenv would: last
# assignment wins, an optional `export` prefix, single or double quotes, and an
# inline comment after an unquoted value. Prints the value, or fails when the
# file has no usable one.
_nlp_service_from_env_file() {
  local file="$1"
  [ -f "$file" ] || return 1

  local raw
  raw=$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?LANGWATCH_NLP_SERVICE[[:space:]]*=[[:space:]]*(.*)$/\2/p' "$file" | tail -n 1)
  raw="${raw%$'\r'}"

  case "$raw" in
    \"*)
      raw="${raw#\"}"
      raw="${raw%%\"*}"
      ;;
    \'*)
      raw="${raw#\'}"
      raw="${raw%%\'*}"
      ;;
    *)
      raw="${raw%%#*}"
      raw="${raw%"${raw##*[![:space:]]}"}"
      ;;
  esac

  [ -n "$raw" ] || return 1
  printf '%s' "$raw"
}

resolve_nlp_service() {
  # The workspace root: both env layers live beside each other there now.
  local repo_root="${1:-.}"
  local file value

  for file in "$repo_root/.env.portless" "$repo_root/.env"; do
    if value=$(_nlp_service_from_env_file "$file"); then
      export LANGWATCH_NLP_SERVICE="$value"
      echo "  ✓ nlpgo: LANGWATCH_NLP_SERVICE=${value} (from $(basename "$file"))"
      return 0
    fi
  done

  return 0
}

#!/bin/bash
# Resolve the address a service is going to be dialed at, so `pnpm dev` starts
# that service on the port something actually talks to.
#
# platform/app/scripts/start.sh runs before any Node entry point, and the shell
# never loads platform/app/.env. The app does, with `override: true`
# (platform/app/src/env-load.ts), so an address pinned in .env is what it dials
# and the launcher cannot see it. Without this the launcher reads an unset
# variable, derives a port from its own slot, starts a service there, and every
# call fails while a healthy service sits on the other port.
#
# Precedence mirrors env-load.ts exactly, because the goal is to predict what
# the app will resolve: .env.portless (the haven overlay, loaded last) beats
# .env, and both beat the calling shell. Leaving the variable untouched means
# nothing pinned an address, which is the caller's cue to derive its own.
#
# Usage:
#
#   . "$(dirname "$0")/../../../dev/scripts/lib/resolve-service-address.sh"
#   resolve_service_address LANGWATCH_NLP_SERVICE "$app_dir" nlpgo

# Reads one variable out of one env file the way dotenv would: last assignment
# wins, an optional `export` prefix, single or double quotes, and an inline
# comment after an unquoted value. Prints the value, or fails when the file has
# no usable one.
_service_address_from_env_file() {
  local var="$1"
  local file="$2"
  [ -f "$file" ] || return 1

  local raw
  raw=$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${var}[[:space:]]*=[[:space:]]*(.*)\$/\\2/p" "$file" | tail -n 1)
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

# Exports `var` with the address the app will read, and says where it came from.
# Leaves it untouched when no env file pins one.
resolve_service_address() {
  local var="$1"
  local app_dir="${2:-.}"
  local label="${3:-$1}"
  local file value

  for file in "$app_dir/.env.portless" "$app_dir/.env"; do
    if value=$(_service_address_from_env_file "$var" "$file"); then
      export "$var=$value"
      echo "  ✓ ${label}: ${var}=${value} (from $(basename "$file"))"
      return 0
    fi
  done

  return 0
}

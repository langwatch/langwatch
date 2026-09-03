#!/bin/bash
# Resolve the address a service is going to be dialed at, so `pnpm dev` starts
# that service on the port something actually talks to.
#
# dev/scripts/dev-stack.sh runs before any Node entry point, and the shell never
# loads .env. The applications do, with `override: true`, so an address pinned
# in .env is what they dial and the launcher cannot see it. Without this the
# launcher reads an unset variable, derives a port from its own slot, starts a
# service there, and every call fails while a healthy service sits on the other
# port.
#
# Precedence mirrors the applications' own load order, because the goal is to
# predict what they will resolve: .env.portless (the haven overlay, loaded last)
# beats .env, and both beat the calling shell. Leaving the variable untouched
# means nothing pinned an address, which is the caller's cue to derive its own.
#
# Both env layers live beside each other at the workspace root.
#
# Usage:
#
#   . "$(dirname "$0")/lib/resolve-service-address.sh"
#   resolve_service_address LANGWATCH_NLP_SERVICE "$repo_root" nlpgo

# Reads one variable out of one env file the way dotenv would: last assignment
# wins, an optional `export` prefix, single or double quotes, and an inline
# comment after an unquoted value.
#
# Prints the value and returns 0. Returns 1 when the file assigns the variable
# nowhere, and 2 when it assigns it an empty value, which is a different answer:
# dotenv gives the app an empty string there, so the file has cleared whatever a
# lower-precedence file said rather than saying nothing about it.
_service_address_from_env_file() {
  local var="$1"
  local file="$2"
  [ -f "$file" ] || return 1

  local assigned raw
  assigned=$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${var}[[:space:]]*=.*\$/y/p" "$file" | tail -n 1)
  [ -n "$assigned" ] || return 1

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

  [ -n "$raw" ] || return 2
  printf '%s' "$raw"
}

# Exports `var` with the address the app will read, and says where it came from.
# Leaves it untouched when no env file pins one.
resolve_service_address() {
  local var="$1"
  local repo_root="${2:-.}"
  local label="${3:-$1}"
  local file value status

  for file in "$repo_root/.env.portless" "$repo_root/.env"; do
    # `|| status=$?` keeps this out of `set -e`'s reach: a bare assignment from
    # a failing command substitution ends the caller's script.
    status=0
    value=$(_service_address_from_env_file "$var" "$file") || status=$?
    if [ "$status" -eq 0 ]; then
      export "$var=$value"
      echo "  ✓ ${label}: ${var}=${value} (from $(basename "$file"))"
      return 0
    fi
    # An empty assignment is this file's answer, not a gap to look past. The app
    # would read an empty string here, so the launcher derives its own address
    # rather than exporting the value a lower-precedence file still holds. An
    # address exported into the shell goes too, because the file overrides it.
    if [ "$status" -eq 2 ]; then
      unset "$var"
      echo "  ✓ ${label}: ${var} cleared by $(basename "$file")"
      return 0
    fi
  done

  return 0
}

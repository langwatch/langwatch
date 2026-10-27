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
# predict what they will resolve: `.env` at the workspace root beats the calling
# shell. Leaving the variable untouched means nothing pinned an address, which is
# the caller's cue to derive its own.
#
# There is one file to read. Under haven the resolved address is injected into
# each lane's environment rather than written to an overlay file, and this script
# is the plain `pnpm dev` path, which haven does not run.
#
# Usage:
#
#   . "$(dirname "$0")/lib/resolve-service-address.sh"
#   resolve_service_address LANGWATCH_NLP_SERVICE "$repo_root" nlpgo

# The dotenv key parser, shared with the two ensure scripts.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env-file-keys.sh"

# The three-state read this file's precedence rules are built on: 0 with the
# value, 1 when the file assigns the variable nowhere, 2 when it assigns it an
# empty value. Named here because the callers below read addresses, not keys.
_service_address_from_env_file() {
  env_file_key_read "$1" "$2"
}

# Exports `var` with the address the app will read, and says where it came from.
# Leaves it untouched when no env file pins one.
resolve_service_address() {
  local var="$1"
  local repo_root="${2:-.}"
  local label="${3:-$1}"
  local file value status

  for file in "$repo_root/.env"; do
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

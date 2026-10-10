#!/bin/bash
# Read and write single keys in a dotenv file.
#
# Three callers, one parser: dev/scripts/lib/resolve-service-address.sh (which
# address a service will be dialed at), dev/scripts/ensure-ai-gateway-secrets.sh
# (the three gateway secrets) and dev/scripts/ensure-langy-dev-env.sh (the Langy
# block). The two ensure scripts only ever write a key that is missing or
# assigned an empty value, so a value the developer chose is never touched.
#
# Usage:
#
#   . "$(dirname "$0")/lib/env-file-keys.sh"
#   env_file_key_is_empty_or_missing "$ENV_FILE" LANGY_INTERNAL_SECRET && \
#     env_file_set_key "$ENV_FILE" LANGY_INTERNAL_SECRET "$(openssl rand -hex 32)"

# Reads one key the way dotenv would: last assignment wins, an optional `export`
# prefix, single or double quotes, and an inline comment after an unquoted
# value.
#
# Prints the value and returns 0. Returns 1 when the file assigns the key
# nowhere, and 2 when it assigns it an empty value, which is a different answer:
# dotenv gives the app an empty string there, so the file has cleared whatever a
# lower-precedence file said rather than saying nothing about it.
env_file_key_read() {
  local key="$1" file="$2" assigned raw
  [ -f "$file" ] || return 1

  assigned=$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=.*\$/y/p" "$file" | tail -n 1)
  [ -n "$assigned" ] || return 1

  raw=$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=[[:space:]]*(.*)\$/\\2/p" "$file" | tail -n 1)
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

# The value the file assigns a key, or nothing and a non-zero status when the
# key is absent or empty. The two are one answer to a caller that is about to
# fill the key in either way.
env_file_key_value() {
  env_file_key_read "$2" "$1"
}

# True when the file assigns the key nothing, or assigns it an empty value in
# any of the spellings a developer writes: bare, "" and ''.
env_file_key_is_empty_or_missing() {
  ! env_file_key_value "$1" "$2" >/dev/null
}

# Give the key a value: replace the assignment in place when the file already
# has one, append it otherwise. The replacement goes through a temp file so an
# interrupted write cannot leave a half-truncated .env behind.
env_file_set_key() {
  local file="$1" key="$2" value="$3" tmp
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file"; then
    tmp=$(mktemp)
    awk -v k="$key" -v v="$value" '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?"k"[[:space:]]*=" { print k "=" v; next }
      { print }
    ' "$file" >"$tmp" && mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

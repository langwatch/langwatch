#!/usr/bin/env bash
# Helpers for auto-starting the bundled Go services (aigateway, nlpgo) from
# `pnpm dev`. Sourced by start.sh; safe to source under `set -eo pipefail`
# (every function ends on a zero-status echo). No side effects on source.

# Decide whether `pnpm dev` should boot a bundled Go service.
#
# Usage: go_service_should_start <skip_flag> <port>
# Echoes exactly one verdict:
#   start              -> boot it
#   skip:opted-out     -> skip flag is "1" (silent skip)
#   skip:no-go-toolchain -> `go` is not on PATH
#   skip:port-in-use   -> something already listens on <port> (reuse it)
go_service_should_start() {
  local skip_flag="$1" port="$2"
  if [ "$skip_flag" = "1" ]; then
    echo "skip:opted-out"
    return
  fi
  if ! command -v go >/dev/null 2>&1; then
    echo "skip:no-go-toolchain"
    return
  fi
  if lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "skip:port-in-use"
    return
  fi
  echo "start"
}

# Resolve the port the nlpgo engine should bind so it matches the URL the app
# will call (LANGWATCH_NLP_SERVICE).
#
# Usage: nlpgo_bind_port <app_port> <nlp_service_url>
# Echoes a numeric port to bind, or "remote" when the configured URL points at
# a non-local host (the developer wants a shared/remote nlpgo, so pnpm dev must
# not spin up a local one). When the URL is empty the port is derived as
# <app_port> + 1, keeping each worktree's nlpgo on its own slot.
nlpgo_bind_port() {
  local app_port="$1" url="$2"
  if [ -z "$url" ]; then
    echo $((app_port + 1))
    return
  fi
  local hostport="${url#*://}" # strip scheme
  hostport="${hostport%%/*}"   # strip any path
  local host="${hostport%%:*}"
  local port="${hostport##*:}"
  case "$host" in
    localhost | 127.0.0.1 | 0.0.0.0)
      # A bare host with no ":port" leaves port == host; only echo it when it
      # is a real number, otherwise fall back to the derived slot.
      if [ "$port" != "$host" ] && [ "$port" -eq "$port" ] 2>/dev/null; then
        echo "$port"
      else
        echo $((app_port + 1))
      fi
      ;;
    *)
      echo "remote"
      ;;
  esac
}

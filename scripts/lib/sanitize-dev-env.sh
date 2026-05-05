#!/bin/bash
# Sanitize stale localhost-pinned dev env vars so worktree-isolated runs
# don't 403 when APP_PORT is dynamic (lw#3453).
#
# Why this exists:
#
# `compose.dev.yml` interpolates BASE_HOST / NEXTAUTH_URL with a fallback
# of `http://localhost:${APP_PORT}` so dynamic-port worktrees Just Work™.
# But the `${VAR:-default}` shell rule means an *exported* localhost URL
# from a previous session (or a zsh helper) wins over the dynamic port,
# and login then 403s because the cookie/CSRF origin is wrong.
#
# Real overrides (boxd proxy, ngrok, prod-style hostname) are NOT
# touched — only stale `http://localhost:<port>` values get rewritten.
#
# Usage from the dev launcher (after APP_PORT is exported):
#
#   . scripts/lib/sanitize-dev-env.sh
#   sanitize_localhost_dev_env
#
# Sources caller-controlled APP_PORT; emits a one-line log per overwrite.

# Returns 0 if value is unset/empty or matches `http://localhost:*`,
# 1 otherwise (real override — leave alone).
__is_stale_localhost_url() {
  local value="$1"
  if [ -z "$value" ]; then
    return 0
  fi
  case "$value" in
    http://localhost:*) return 0 ;;
    *) return 1 ;;
  esac
}

sanitize_localhost_dev_env() {
  if [ -z "${APP_PORT:-}" ]; then
    echo "WARNING: sanitize_localhost_dev_env called before APP_PORT is set" >&2
    return 1
  fi

  local target="http://localhost:${APP_PORT}"

  if __is_stale_localhost_url "${NEXTAUTH_URL:-}"; then
    if [ -n "${NEXTAUTH_URL:-}" ] && [ "$NEXTAUTH_URL" != "$target" ]; then
      echo "  → rewriting stale NEXTAUTH_URL=$NEXTAUTH_URL to $target"
    fi
    export NEXTAUTH_URL="$target"
  fi

  if __is_stale_localhost_url "${BASE_HOST:-}"; then
    if [ -n "${BASE_HOST:-}" ] && [ "$BASE_HOST" != "$target" ]; then
      echo "  → rewriting stale BASE_HOST=$BASE_HOST to $target"
    fi
    export BASE_HOST="$target"
  fi
}

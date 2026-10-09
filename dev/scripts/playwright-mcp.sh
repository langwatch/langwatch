#!/bin/bash
# Wrapper for Playwright MCP that auto-detects the browser executable.
# Used by .mcp.json to support ARM64 Linux (no Google Chrome available).

# Find the Playwright Chromium binary
CHROMIUM_PATH=$(find ~/.cache/ms-playwright -name "chrome" -path "*/chrome-linux*" 2>/dev/null | sort -V | tail -1)

if [ -z "$CHROMIUM_PATH" ]; then
  # Try system chromium
  CHROMIUM_PATH=$(which chromium-browser 2>/dev/null || which chromium 2>/dev/null || true)
fi

EXTRA_ARGS=()
if [ -n "$CHROMIUM_PATH" ]; then
  EXTRA_ARGS+=(--executable-path "$CHROMIUM_PATH")
fi

HEADLESS_FLAG="--headless"
if [ "$1" = "--headed" ]; then
  HEADLESS_FLAG=""
  shift
fi

# A hard-killed session cannot signal this MCP, and the Chrome it launches
# outlives even the MCP. The hook makes the MCP notice it was orphaned and
# shut its browser down (specs/setup/mcp-browser-lifecycle.feature).
ORPHAN_HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/die-with-parent.cjs"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require \"$ORPHAN_HOOK\""

# `npx @playwright/mcp@latest` does a registry lookup on every cold start (~55s
# observed on this machine — well over Claude Code's 30s MCP-connect timeout).
# Resolve to the already-installed CLI directly. Fall back to npx only if the
# cached install can't be found.
CACHED_CLI=$(find ~/.npm/_npx -path "*/node_modules/@playwright/mcp/cli.js" 2>/dev/null | head -1)
if [ -n "$CACHED_CLI" ] && [ -f "$CACHED_CLI" ]; then
  exec node "$CACHED_CLI" $HEADLESS_FLAG "${EXTRA_ARGS[@]}" "$@"
else
  exec npx --offline @playwright/mcp $HEADLESS_FLAG "${EXTRA_ARGS[@]}" "$@" 2>/dev/null \
    || exec npx @playwright/mcp@latest $HEADLESS_FLAG "${EXTRA_ARGS[@]}" "$@"
fi

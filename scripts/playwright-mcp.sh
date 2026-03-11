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

exec npx @playwright/mcp@latest --headless "${EXTRA_ARGS[@]}" "$@"

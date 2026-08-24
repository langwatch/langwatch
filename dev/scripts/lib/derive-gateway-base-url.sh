#!/bin/bash
# Derive LW_GATEWAY_BASE_URL from PORT when it is not already set, so a
# standalone `make service svc=aigateway` / `make service-watch
# svc=aigateway` targets THIS worktree's control plane instead of silently
# falling back to services/aigateway/config.go's compatibility default
# (http://localhost:5560), which is only correct for a single worktree on
# the default port.
#
# Mirrors platform/app/scripts/start.sh's own derivation exactly: PORT + 1000
# is the API port `pnpm dev` binds its Hono backend to, so a gateway started
# either way ends up pointed at the same place. An explicit
# LW_GATEWAY_BASE_URL, whether inherited from the calling shell or set in
# .env, always wins; this only fills the gap when nothing set
# it at all.
#
# Usage from the Makefile, after .env is sourced:
#
#   . dev/scripts/lib/derive-gateway-base-url.sh
#   derive_gateway_base_url

derive_gateway_base_url() {
  if [ -n "${LW_GATEWAY_BASE_URL:-}" ]; then
    return 0
  fi

  local app_port="${PORT:-5560}"
  local api_port=$((app_port + 1000))
  export LW_GATEWAY_BASE_URL="http://localhost:${api_port}"
  echo "  ✓ LW_GATEWAY_BASE_URL derived from PORT=${app_port} -> ${LW_GATEWAY_BASE_URL}"
}

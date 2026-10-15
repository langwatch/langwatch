#!/bin/bash
# The image's default command: the api, or the api and the worker in one process.
# START_WORKERS=true (or 1) is the previous release's switch for that; apps/backend hosts both.
# PORT is the previous release's port variable; API_PORT wins when both are set.
set -eo pipefail

export API_PORT="${API_PORT:-${PORT:-5560}}"

case "${START_WORKERS:-}" in
  true | 1) cd /app/apps/backend ;;
  *) cd /app/apps/api ;;
esac
exec pnpm --silent run start

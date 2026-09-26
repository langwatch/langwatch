#!/bin/bash

set -eo pipefail

run_startup_preflight() {
  pnpm run start:prepare:db
  pnpm run task system-migrations
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  run_startup_preflight
  exec "$@"
fi

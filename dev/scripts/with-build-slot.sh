#!/bin/sh
# Usage: with-build-slot.sh <label> <command> [args...]
# Runs a heavy build in a `build` slot of haven's machine budget
# (dev/docs/plans/haven-exec-policy.md section 4); inside a held slot, or with
# no haven (CI, images, the npx server), the command runs directly.
label=$1
shift
haven=${HAVEN_BIN:-$(command -v haven 2>/dev/null)}
if [ -z "$CHECK_QUEUE_HELD" ] && [ -n "$haven" ] && [ -x "$haven" ]; then
  exec "$haven" machine slot run --class build --label "$label" -- "$@"
fi
exec "$@"

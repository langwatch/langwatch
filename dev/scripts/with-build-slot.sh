#!/bin/sh
# Usage: with-build-slot.sh <label> <command> [args...]
# Runs a build in haven's `build` slot (dev/docs/plans/haven-exec-policy.md s4),
# or in rush's gate when it holds a shim for the program. A held run, haven's own
# stack UI rebuild (HAVEN_STACK_BUILD; rush's node preload told it is held) and a
# machine with neither (CI, images, the npx server) run directly, capped.
label=$1
shift
program=$(basename "$1")
if [ -n "$HAVEN_STACK_BUILD" ]; then
  export RUSH_GATE_HELD="${RUSH_GATE_HELD:-haven-stack-build}"
fi
if [ -n "$RUSH_GATE_HELD" ] || [ -n "$CHECK_QUEUE_HELD" ]; then
  export GOMAXPROCS="${GOMAXPROCS:-2}" GOMEMLIMIT="${GOMEMLIMIT:-3GiB}"
  exec "$@"
fi
config="$HOME/.config"
rush_root=${RUSH_HOME:-$config/rush}
if [ -z "$RUSH_HOME" ] && [ ! -f "$config/rush/config.json" ] && [ -f "$config/agtop/config.json" ]; then
  rush_root=$config/agtop
fi
rush=${RUSH_BIN:-$(command -v rush 2>/dev/null)}
if [ -f "$rush_root/gate/bin/$program" ] && [ -n "$rush" ] && [ -x "$rush" ]; then
  export GOMAXPROCS="${GOMAXPROCS:-2}" GOMEMLIMIT="${GOMEMLIMIT:-3GiB}"
  exec "$rush" gate run --name "$program" --dir "$PWD" -- "$@"
fi
haven=${HAVEN_BIN:-$(command -v haven 2>/dev/null)}
if [ -n "$haven" ] && [ -x "$haven" ]; then
  exec "$haven" machine slot run --class build --label "$label" -- "$@"
fi
exec "$@"

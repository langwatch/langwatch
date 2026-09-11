#!/usr/bin/env bash
# What a coordinator needs to know before it does anything, read from disk
# rather than remembered.
#
#   (no arguments)   fast. Roster rows and the newest handover's next action.
#                    Prints nothing at all when there is no drive in progress,
#                    because it runs on every session start in this repository.
#   --full           adds the shape counters. About 1.5s; for /coordinator, not
#                    for a hook.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

ROSTER=.claude/coordinator/LANES.md
HANDOVER=$(ls -1 dev/docs/plans/handover-*.md 2>/dev/null | sort | tail -1 || true)

active=0
if [ -f "$ROSTER" ]; then
  active=$(grep -c '| active |' "$ROSTER" 2>/dev/null || true)
  active=${active:-0}
fi

# Nothing to say: no roster and no handover means no drive is in progress.
if [ "$active" -eq 0 ] && [ -z "$HANDOVER" ]; then
  exit 0
fi

if [ "$active" -gt 0 ]; then
  printf 'coordinator: %s lane(s) ACTIVE - this session cannot be replaced until they are collected.\n' "$active"
  grep '| active |' "$ROSTER" | awk -F'|' '{printf "  - %s (%s)\n", $2, $4}' | tr -s ' '
else
  printf 'coordinator: no lanes active.\n'
fi

if [ -n "$HANDOVER" ]; then
  next=$(awk '/^## Exact next action/{flag=1;next} /^## /{flag=0} flag && NF' "$HANDOVER" | head -2)
  printf 'handover: %s\n' "$HANDOVER"
  [ -n "$next" ] && printf '%s\n' "$next" | sed 's/^/  /'
fi

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ' || true)
printf 'dirty=%s  run /coordinator to pick this up.\n' "${dirty:-unknown}"

if [ "${1:-}" = "--full" ]; then
  printf '\n'
  bash dev/scripts/shape-counters.sh 2>/dev/null || true
fi

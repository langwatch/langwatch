#!/usr/bin/env bash
# The shared claim board. Every agent working in this checkout - this session's
# lanes, a Codex session, a person - takes a claim before editing files and
# releases it after. A claim is advisory: it says who is holding which paths so
# two agents do not rewrite the same file, and it costs one line.
#
#   bash dev/scripts/claim.sh take <who> "<task>" <path> [path...]
#   bash dev/scripts/claim.sh list                     # every live claim
#   bash dev/scripts/claim.sh check <path> [path...]   # who holds these, if anyone
#   bash dev/scripts/claim.sh done <who>               # release every claim of one holder
#
# The board is .claims.tsv at the repo root, git-ignored, one line per claim:
# taken-at, holder, task, paths (space separated). A claim older than three
# hours is reported as stale by `list` rather than removed, because an agent
# that died still tells you where it died.
set -u
root=$(git rev-parse --show-toplevel)
board="$root/.claims.tsv"
lock="$board.lock"
touch "$board"

hold() { local i=0; while ! mkdir "$lock" 2>/dev/null; do i=$((i+1)); [ $i -gt 50 ] && { rm -rf "$lock"; continue; }; sleep 0.1; done; }
free() { rm -rf "$lock"; }

case "${1:-}" in
  take)
    who=$2; task=$3; shift 3
    hold
    for want in "$@"; do
      while IFS=$'\t' read -r _at holder _task paths; do
        [ -z "${holder:-}" ] && [ -z "${paths:-}" ] && continue
        [ "$holder" = "$who" ] && continue
        for held in $paths; do
          case "$want/" in "$held"/*) free; echo "refused: $want is held by $holder ($held)"; exit 1;; esac
          case "$held/" in "$want"/*) free; echo "refused: $want covers $held, held by $holder"; exit 1;; esac
        done
      done < "$board"
    done
    printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$who" "$task" "$*" >> "$board"
    free
    echo "claimed by $who: $*"
    ;;
  list)
    now=$(date -u +%s)
    while IFS=$'\t' read -r at who task paths; do
      [ -z "${at:-}" ] && continue
      then_s=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$at" +%s 2>/dev/null || echo "$now")
      age=$(( (now - then_s) / 60 ))
      stale=""; [ $age -gt 180 ] && stale=" STALE"
      printf '%-22s %-4dm%s  %s\n    %s\n' "$who" "$age" "$stale" "$task" "$paths"
    done < "$board"
    ;;
  check)
    shift
    for p in "$@"; do
      grep -F -- "$p" "$board" | awk -F'\t' -v p="$p" '{print p" is held by "$2" since "$1" ("$3")"}'
    done
    ;;
  done)
    who=$2
    hold
    grep -v -P "^[^\t]*\t\Q$who\E\t" "$board" > "$board.new" 2>/dev/null || grep -v "	$who	" "$board" > "$board.new"
    mv "$board.new" "$board"
    free
    echo "released $who"
    ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac

#!/bin/bash
# Frees the given dev ports by taking down the process group behind each one.
#
#   bash scripts/kill-dev-tree.sh 5560,6560,2999
#
# Scoped by construction: the ports decide what to touch. It resolves them to
# the node processes LISTENING there, and from those to the process group each
# belongs to. A `pnpm dev` stack is exactly one such group, so Docker, other
# worktrees and everything else on the machine are out of reach.
#
# Two things this gets right that the obvious one-liner does not.
#
# Asking is not enough. `start.sh` runs `concurrently --restart-tries -1`,
# whose whole job is to replace a lane that dies, so a plain SIGTERM to the
# group kills the lanes and hands back a fresh set: same group, new lane pids,
# port busy again. So this asks, waits, and then insists.
#
# And a freed port is not a stopped stack. Between killing a lane and its
# replacement binding, the port is briefly free, so a script that waits on the
# port reports success into a gap and the port comes back seconds later.
# What has to go quiet is the group.

# No `set -e`: `lsof` exits 1 when a port is free, which is the good path.
set -uo pipefail

PORTS="${1:-}"
if [ -z "$PORTS" ]; then
  echo "usage: kill-dev-tree.sh <comma-separated ports>" >&2
  exit 64
fi

# How long the stack gets to go down on its own before SIGKILL.
GRACE_SECONDS="${KILL_DEV_TREE_GRACE:-5}"

OWN_PGID=$(ps -p $$ -o pgid= 2>/dev/null | tr -d ' ')

if ! command -v lsof >/dev/null 2>&1 && ! command -v ss >/dev/null 2>&1; then
  echo "need lsof or ss to find what is holding ${PORTS}" >&2
  exit 69
fi

SS_FILTER=""
for _port in ${PORTS//,/ }; do
  SS_FILTER="${SS_FILTER}${SS_FILTER:+ or }sport = :${_port}"
done

# Is anything at all listening there, pid or no pid. Kept separate from
# resolving pids so "I cannot see who owns this" never reads as "it is free".
#
# A lookup that FAILS is not an empty result either, it is a refusal to answer,
# and this script exists to stop saying "free" about ports nobody checked. `ss`
# exits 0 with no output for a port that is genuinely free, so a non-zero status
# is unambiguously a broken lookup and we stop rather than guess. lsof gets no
# such treatment: it returns 1 both for "found nothing" and for real errors, so
# its status carries nothing to act on.
port_busy() {
  local found
  if command -v lsof >/dev/null 2>&1; then
    [ -n "$(lsof -t -a -iTCP:"$PORTS" -sTCP:LISTEN 2>/dev/null)" ]
    return
  fi
  if ! found=$(ss -ltnH "( ${SS_FILTER} )" 2>/dev/null); then
    echo "ss could not inspect ${PORTS}, refusing to guess whether it is free" >&2
    exit 69
  fi
  [ -n "$found" ]
}

# Whatever is listening on those ports. lsof is what the rest of the dev
# scripts use; ss covers the Linux hosts that ship iproute2 and not lsof.
# A failing `ss` stops us the same way it does in port_busy: an empty answer
# from a lookup that broke is not "nobody is listening".
listening_pids() {
  local found
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -a -iTCP:"$PORTS" -sTCP:LISTEN 2>/dev/null
    return
  fi
  if ! found=$(ss -ltnpH "( ${SS_FILTER} )" 2>/dev/null); then
    echo "ss could not inspect ${PORTS}, refusing to guess whether it is free" >&2
    exit 69
  fi
  printf '%s\n' "$found" | grep -o 'pid=[0-9]*' | cut -d= -f2
}

# What a pid is. Linux answers from /proc, which is authoritative and needs no
# output parsing at all; ps is the fallback for macOS, asked two ways because
# neither is portable on its own. `comm` is the bare binary name on Linux and
# the full path on macOS, and `args` is the whole command line, which always
# begins with the interpreter. Relying on `comm` alone is what made this miss
# node processes it had correctly found.
describe_pid() {
  if [ -r "/proc/$1/cmdline" ]; then
    tr '\0' ' ' <"/proc/$1/cmdline"
    return
  fi
  ps -p "$1" -o comm= 2>/dev/null
  ps -p "$1" -o args= 2>/dev/null
}

# The process groups behind those listeners, node ones only, so a port that
# happens to be held by something else on the machine is left where it is.
# Never our own group either: this is usually pasted into the very shell that
# is about to retry `pnpm dev`, and closing that would be its own surprise.
listening_groups() {
  listening_pids | sort -u | while read -r pid; do
    [ -n "$pid" ] || continue
    case "$(describe_pid "$pid")" in
      *node*) ;;
      *) continue ;;
    esac
    pgid=$(ps -p "$pid" -o pgid= 2>/dev/null | tr -d ' ')
    [ -n "$pgid" ] || continue
    [ "$pgid" -gt 1 ] 2>/dev/null || continue
    if [ "$pgid" != "$OWN_PGID" ]; then echo "$pgid"; fi
  done | sort -u
}

# What we saw but did not claim, so "not a node process of ours" is a finding
# rather than an assertion. Without this the message is the same whether the
# port really belongs to someone else or we simply failed to identify it.
describe_listeners() {
  listening_pids | sort -u | while read -r pid; do
    [ -n "$pid" ] || continue
    echo "${pid}:$(describe_pid "$pid" | tr '\n' ' ' | cut -c1-60)"
  done | tr '\n' ' '
}

# Whether any member of the group is still running, asked of the process table
# rather than through `kill -0 -pgid`, whose answer for a group is not portable.
# Zombies deliberately do not count: they hold no port and no memory, and a
# leader whose parent has not reaped it yet would otherwise read as alive.
group_alive() {
  ps -Ao pgid= -o stat= 2>/dev/null |
    awk -v want="$1" '$1 == want && $2 !~ /^Z/ { alive = 1 } END { exit !alive }'
}

still_alive() {
  local pgid
  for pgid in "$@"; do
    if group_alive "$pgid"; then echo "$pgid"; fi
  done
}

# Deliberately not an array named GROUPS: bash keeps a read-only GROUPS of the
# user's unix group ids, so assigning to it is silently ignored and what
# survives is 20/80/12, real system process groups.
signal_groups() {
  local signal="$1"
  shift
  local pgid
  for pgid in "$@"; do
    kill "-${signal}" "-${pgid}" 2>/dev/null
  done
}

targets=$(listening_groups)
if [ -z "$targets" ]; then
  # Nothing to signal, but that is two different situations and only one of
  # them is good news. Saying "free" over a port we simply could not attribute
  # is how a takedown reports success and leaves the stack running.
  if port_busy; then
    echo "something is listening on ${PORTS} that is not a node process of ours, leaving it alone (saw: $(describe_listeners))" >&2
    exit 1
  fi
  echo "nothing of ours is listening on ${PORTS}"
  exit 0
fi

# shellcheck disable=SC2086 # word splitting the newline list is the point
set -- $targets

echo "stopping dev stack process group(s): $*"
signal_groups TERM "$@"

for _ in $(seq 1 $((GRACE_SECONDS * 4))); do
  [ -z "$(still_alive "$@")" ] && break
  sleep 0.25
done

survivors=$(still_alive "$@")
if [ -n "$survivors" ]; then
  # shellcheck disable=SC2086 # word splitting the newline list is the point
  set -- $survivors
  echo "still up after ${GRACE_SECONDS}s, killing: $*"
  signal_groups KILL "$@"
  for _ in $(seq 1 20); do
    [ -z "$(still_alive "$@")" ] && break
    sleep 0.25
  done
fi

if [ -n "$(still_alive "$@")" ]; then
  echo "could not stop $(still_alive "$@" | tr '\n' ' ')" >&2
  exit 1
fi

# The stack is gone. Anything still on the port belongs to someone else, and
# saying so beats claiming a port we did not actually free.
if port_busy; then
  echo "stack stopped, but ${PORTS} still has a listener we did not start" >&2
  exit 1
fi

echo "ports free: ${PORTS}"

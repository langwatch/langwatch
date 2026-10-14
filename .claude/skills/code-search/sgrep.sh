#!/usr/bin/env bash
# sgrep helper for agents: status | query | index | stop. See SKILL.md beside this file.
# Exit 3 = no usable index (missing or still building): fall back to ripgrep.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
MAIN_ROOT=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)
SGREP_HOME=${SGREP_HOME:-$HOME/.sgrep}
STATE=$SGREP_HOME/langwatch
MODEL=$SGREP_HOME/models/nomic-embed-text-v1.5.Q8_0.gguf
mkdir -p "$STATE"

sgrep_bin() {
  if command -v sgrep >/dev/null; then command -v sgrep
  elif [ -x "$ROOT/.bin/sgrep/sgrep" ]; then echo "$ROOT/.bin/sgrep/sgrep"
  elif [ -x "$MAIN_ROOT/.bin/sgrep/sgrep" ]; then echo "$MAIN_ROOT/.bin/sgrep/sgrep"
  else echo "sgrep not installed: see Install in SKILL.md" >&2; exit 3; fi
}

abs() { (cd "$1" && pwd -P); }
key() { echo "$1" | shasum | cut -c1-12; }

# The indexed directory that holds $1, or nothing.
indexed_root() {
  local target best=""; target=$(abs "$1")
  while read -r dir; do
    [ -f "$STATE/$(key "$dir").failed" ] && continue
    case "$target/" in "$dir"/*) [ ${#dir} -gt ${#best} ] && best=$dir ;; esac
  done < <("$(sgrep_bin)" list 2>/dev/null | sed -n 's#^  \(/.*\)$#\1#p')
  echo "$best"
}

building() {
  local lock="$STATE/$(key "$1").building"
  [ -f "$lock" ] && kill -0 "$(cat "$lock")" 2>/dev/null
}

# sgrep's managed server gives each slot 512 tokens but sends chunks up to ~620,
# failing the whole index; our own server gives each slot 2048.
start_server() {
  local port=8091
  while lsof -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; do port=$((port + 1)); done
  llama-server -m "$MODEL" --embedding --port $port --host localhost \
    -c 8192 -b 2048 -ub 2048 -np 4 -cb -ngl 99 --threads 8 >"$STATE/llama.log" 2>&1 &
  echo $! >"$STATE/llama.pid"
  for _ in $(seq 60); do
    if curl -sf "localhost:$port/health" >/dev/null; then
      echo "http://localhost:$port" >"$STATE/endpoint"
      return 0
    fi
    sleep 1
  done
  echo "embedding server did not come up in 60s; log: $STATE/llama.log" >&2
  stop_server
  return 3
}

stop_server() {
  [ -f "$STATE/llama.pid" ] && kill "$(cat "$STATE/llama.pid")" 2>/dev/null || true
  rm -f "$STATE/llama.pid" "$STATE/endpoint"
}

ensure_server() {
  if [ -f "$STATE/endpoint" ] && curl -sf "$(cat "$STATE/endpoint")/health" >/dev/null; then return; fi
  start_server
}

cmd=${1:-}; shift || true
case "$cmd" in
  status)
    path=${1:-.}; dir=$(abs "$path")
    if building "$dir"; then echo "building: $dir (log: $STATE/$(key "$dir").log)"; exit 3; fi
    root=$(indexed_root "$path")
    if [ -n "$root" ] && ! building "$root"; then echo "ready: $root"; else echo "none: $dir"; exit 3; fi
    ;;
  query)
    path=$1; shift
    root=$(indexed_root "$path")
    if [ -z "$root" ] || building "$root"; then echo "no ready index for $path: use rg" >&2; exit 3; fi
    ensure_server || exit 3
    cd "$root" && SGREP_ENDPOINT=$(cat "$STATE/endpoint") "$(sgrep_bin)" "$@"
    ;;
  index)
    dir=$(abs "${1:?usage: sgrep.sh index <dir>}")
    if building "$dir"; then echo "already building: $dir"; exit 0; fi
    [ -f "$MODEL" ] || "$(sgrep_bin)" setup
    log="$STATE/$(key "$dir").log"
    (
      echo $BASHPID >"$STATE/$(key "$dir").building"
      if ensure_server && SGREP_ENDPOINT=$(cat "$STATE/endpoint") "$(sgrep_bin)" index "$dir" --colbert-preindex=false; then
        rm -f "$STATE/$(key "$dir").failed"
      else
        touch "$STATE/$(key "$dir").failed"
      fi
      rm -f "$STATE/$(key "$dir").building"
    ) >"$log" 2>&1 &
    echo "indexing $dir in the background; log: $log"
    ;;
  stop) stop_server ;;
  *) echo "usage: sgrep.sh status [dir] | query <dir> <sgrep args...> | index <dir> | stop" >&2; exit 2 ;;
esac

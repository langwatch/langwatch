#!/usr/bin/env bash
# Parity check for a Go port: runs the TS enforcer and the Go front over the
# same tree and policies and prints SAME or the diff. Point <tree> at a seeded
# copy to prove the messages too.
# Usage: enforcer-diff.sh <tree> <policy-id[,policy-id...]>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tree="$(cd "$1" && pwd)"
policies="$2"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

go -C "$root" build -o "$root/.bin/enforcer/enforcer" ./cmd/enforcer
node --disable-warning=ExperimentalWarning --experimental-transform-types \
  "$root/packages/architecture-enforcer/src/cli.ts" \
  --root "$tree" --all --policies "$policies" >"$out/ts" 2>&1 || true
"$root/.bin/enforcer/enforcer" --root "$tree" --all --policies "$policies" >"$out/go" 2>&1 || true

if cmp -s "$out/ts" "$out/go"; then
  echo "SAME ($(wc -l <"$out/ts" | tr -d ' ') lines)"
else
  diff -u "$out/ts" "$out/go" | head -60
  exit 1
fi

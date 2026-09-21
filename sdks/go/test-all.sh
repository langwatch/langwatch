#!/usr/bin/env bash
#
# Build, vet and test every Go module in the SDK.
#
# The core SDK and each instrumentation are SEPARATE Go modules, so a user who
# imports one provider's instrumentation never pulls in the others' SDKs (and a
# user of the core SDK pulls in no provider SDK at all). This script walks every
# go.mod and exercises it independently.
#
# Usage: ./test-all.sh [extra go test flags...]   e.g. ./test-all.sh -race
# No `-e`: a failing module must not abort the run, the loop aggregates into
# $fail and reports every module. The one thing that must abort is failing to
# reach the SDK root, or the find below walks the wrong tree.
set -uo pipefail
cd "$(dirname "$0")" || { echo "✗ cannot enter $(dirname "$0")"; exit 1; }

fail=0

# Core first — "." sorts ahead of every "./…" subdirectory — then the remaining
# modules in path order. Read line by line so a path containing a space is one
# module, not two; the loop body must stay in this shell so $fail survives it.
while IFS= read -r dir; do
  echo "──────────────────────────────────────────────────────────"
  echo "▶ $dir"
  echo "──────────────────────────────────────────────────────────"
  (
    cd "$dir" || exit 1
    # `go vet` compiles every package (incl. main) so it doubles as the build
    # check, without `go build ./...` writing stray binaries for single-main
    # modules (e.g. examples/filtering).
    #
    # "$@" forwards this script's own arguments, so a flag carrying a space
    # stays one argument.
    go vet ./... &&
      go test -count=1 "$@" ./... &&
      { test -z "$(gofmt -l .)" || { echo "gofmt issues:"; gofmt -l .; exit 1; }; }
  ) || { echo "✗ FAILED: $dir"; fail=1; }
done < <(find . -name go.mod -not -path '*/vendor/*' | sed 's#/go.mod$##' | sort)

echo "──────────────────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then
  echo "✓ all modules green"
else
  echo "✗ one or more modules failed"
fi
exit $fail

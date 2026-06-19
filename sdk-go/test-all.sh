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
set -uo pipefail
cd "$(dirname "$0")"

extra_flags="$*"
fail=0

# Core first, then instrumentation modules, then examples/e2e.
modules=$(find . -name go.mod -not -path '*/vendor/*' | sed 's#/go.mod$##' | sort)

for dir in $modules; do
  echo "──────────────────────────────────────────────────────────"
  echo "▶ $dir"
  echo "──────────────────────────────────────────────────────────"
  (
    cd "$dir" || exit 1
    # `go vet` compiles every package (incl. main) so it doubles as the build
    # check, without `go build ./...` writing stray binaries for single-main
    # modules (e.g. examples/filtering).
    go vet ./... &&
      go test -count=1 $extra_flags ./... &&
      { test -z "$(gofmt -l . | grep -v 'prompts/prompts.go')" || { echo "gofmt issues:"; gofmt -l .; exit 1; }; }
  ) || { echo "✗ FAILED: $dir"; fail=1; }
done

echo "──────────────────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then
  echo "✓ all modules green"
else
  echo "✗ one or more modules failed"
fi
exit $fail

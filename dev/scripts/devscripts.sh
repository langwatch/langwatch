#!/usr/bin/env bash
# Runs the Go dev scripts (cmd/devscripts): generate-modules, sync-references,
# ensure-built. From source with `go run` when Go is installed, otherwise the
# prebuilt .bin/devscripts/devscripts (the Docker image ships only that).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

if command -v go >/dev/null 2>&1; then
  exec go run ./cmd/devscripts "$@"
fi
if [ -x .bin/devscripts/devscripts ]; then
  exec .bin/devscripts/devscripts "$@"
fi
echo "devscripts: neither go nor .bin/devscripts/devscripts is available; install Go or build the binary with: go build -o .bin/devscripts/devscripts ./cmd/devscripts" >&2
exit 1

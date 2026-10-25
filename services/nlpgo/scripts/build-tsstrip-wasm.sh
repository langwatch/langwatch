#!/usr/bin/env sh
# Builds tsstrip.wasm, which erases TypeScript code blocks' types inside the
# engine's wasm runtime (ADR-183). Usage: build-tsstrip-wasm.sh [dest-dir]
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
services="$(cd "${here}/../.." && pwd)"
dest="${1:-${services}/nlpgo/.cache/tsstrip-wasm}"
mkdir -p "${dest}"
cd "${services}"
GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" \
  -o "${dest}/tsstrip.wasm" ./nlpgo/app/engine/blocks/codeblock/tsstrip
echo "tsstrip.wasm -> ${dest}/tsstrip.wasm"

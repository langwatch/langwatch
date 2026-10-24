#!/usr/bin/env bash
# Fetches the QuickJS WASI build JavaScript code blocks run on and verifies it
# against a pinned checksum.
#
#   services/nlpgo/scripts/fetch-quickjs-wasm.sh [dest-dir]
#
# dest-dir defaults to services/nlpgo/.cache/quickjs-wasm, which is where the
# codeblock tests look. The Docker build calls this with its own destination.
set -euo pipefail

VERSION="0.17.0"
SHA256="42a732a676ec2d93488c19411e0fad283bf72658fdad746f089914b523c783b1"
URL="https://github.com/quickjs-ng/quickjs/releases/download/v${VERSION}/qjs-wasi.wasm"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${1:-${here}/../.cache/quickjs-wasm}"
marker="${dest}/.version"

if [[ -f "${marker}" && "$(cat "${marker}")" == "${VERSION}-${SHA256}" ]]; then
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

curl -fsSL --retry 3 -o "${work}/qjs-wasi.wasm" "${URL}"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${work}/qjs-wasi.wasm" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "${work}/qjs-wasi.wasm" | cut -d' ' -f1)"
fi
if [[ "${actual}" != "${SHA256}" ]]; then
  echo "fetch-quickjs-wasm: checksum mismatch: got ${actual}, want ${SHA256}" >&2
  exit 1
fi

mkdir -p "${dest}"
mv "${work}/qjs-wasi.wasm" "${dest}/qjs-wasi.wasm"
echo "${VERSION}-${SHA256}" > "${marker}"

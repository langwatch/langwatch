#!/usr/bin/env bash
# Fetches the CPython WASI build the code-block WASM runtime runs, verifies it
# against a pinned checksum, and precompiles its standard library.
#
#   services/nlpgo/scripts/fetch-python-wasm.sh [dest]
#
# dest defaults to services/nlpgo/.cache/python-wasm, which is where the
# codeblock tests look. The Docker build calls this with its own destination.
#
# The interpreter is a single python.wasm; the standard library sits beside it
# under lib/python3.14. Bytecode is compiled ahead of time with a native
# CPython of the same minor version (bytecode depends on the version, not the
# platform) in unchecked-hash mode, so the read-only mount never needs a
# timestamp check and a cold import costs a load rather than a compile. Without
# it a block that imports asyncio spends seconds compiling the stdlib.
set -euo pipefail

VERSION="3.14.7"
WASI_SDK="24"
SHA256="2e064d3fb8172471d39d741348efa722349c40b96301f69968dff714999c584b"
URL="https://github.com/brettcannon/cpython-wasi-build/releases/download/v${VERSION}/python-${VERSION}-wasi_sdk-${WASI_SDK}.zip"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${1:-${here}/../.cache/python-wasm}"
marker="${dest}/.version"

if [[ -f "${marker}" && "$(cat "${marker}")" == "${VERSION}-${SHA256}" ]]; then
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

curl -fsSL --retry 3 -o "${work}/python.zip" "${URL}"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${work}/python.zip" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "${work}/python.zip" | cut -d' ' -f1)"
fi
if [[ "${actual}" != "${SHA256}" ]]; then
  echo "fetch-python-wasm: checksum mismatch: got ${actual}, want ${SHA256}" >&2
  exit 1
fi

rm -rf "${dest}"
mkdir -p "${dest}"
unzip -q "${work}/python.zip" -d "${dest}"

# Precompile with a native CPython of the same minor version. Whatever is
# found first wins: an installed python3.14, then uv, which fetches one.
minor="${VERSION%.*}"
if command -v "python${minor}" >/dev/null 2>&1; then
  compile=("python${minor}")
elif command -v uv >/dev/null 2>&1; then
  compile=(uv run --no-project --python "${minor}" python)
else
  echo "fetch-python-wasm: need python${minor} or uv to precompile the stdlib" >&2
  exit 1
fi
"${compile[@]}" -m compileall -q -j 0 --invalidation-mode unchecked-hash \
  "${dest}/lib/python${minor}" >/dev/null || true

echo "${VERSION}-${SHA256}" > "${marker}"

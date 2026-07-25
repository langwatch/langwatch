#!/usr/bin/env bash
# Install the goose migration tool. Pinned version + SHA256 verified.
# Used by multiple CI workflows — bumping the version requires only
# editing this file.
set -euo pipefail

GOOSE_VERSION="v3.26.0"
GOOSE_URL="https://github.com/pressly/goose/releases/download/${GOOSE_VERSION}/goose_linux_x86_64"
GOOSE_SHA256="8b3eee9845cd87d827ba1abddb85235fb3684f9fb1666426f647ddd12fd29efe"

# Download to a private temporary file so nothing can swap the binary
# between the checksum and the install.
GOOSE_TMP="$(mktemp)"
trap 'rm -f "$GOOSE_TMP"' EXIT

# Retry the download: a single connection reset against the GitHub release
# CDN otherwise fails a whole integration shard before any test has run.
curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors \
  "$GOOSE_URL" -o "$GOOSE_TMP"
echo "$GOOSE_SHA256  $GOOSE_TMP" | sha256sum -c -
sudo install -m 0755 "$GOOSE_TMP" /usr/local/bin/goose
goose --version

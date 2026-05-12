#!/usr/bin/env bash
# Install the goose migration tool. Pinned version + SHA256 verified.
# Used by multiple CI workflows — bumping the version requires only
# editing this file.
set -euo pipefail

GOOSE_VERSION="v3.26.0"
GOOSE_URL="https://github.com/pressly/goose/releases/download/${GOOSE_VERSION}/goose_linux_x86_64"
GOOSE_SHA256="8b3eee9845cd87d827ba1abddb85235fb3684f9fb1666426f647ddd12fd29efe"

curl -fsSL "$GOOSE_URL" -o /tmp/goose
echo "$GOOSE_SHA256  /tmp/goose" | sha256sum -c - || (rm -f /tmp/goose && exit 1)
sudo mv /tmp/goose /usr/local/bin/goose
chmod +x /usr/local/bin/goose
goose --version

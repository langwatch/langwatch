#!/bin/bash

set -e

cd ..

current_hash=$(git ls-files -o -c -m --exclude-standard | grep -v ^infrastructure | grep -v ^langevals | grep -v ^.github | xargs cat | sha256sum | cut -d' ' -f1 | cut -c 1-7)
cd infrastructure
current_hash_langwatch=$(./scripts/get_langwatch_git_sha.sh | jq -r '.tag')
echo "{\"tag\": \"hash-${current_hash}-${current_hash_langwatch}\", \"git_tag\": \"git-$(git rev-parse --short HEAD)\"}"

#!/bin/bash

set -e

cd ..

if test -z "$(git status --porcelain)"; then
  echo "{\"tag\": \"$(git rev-parse --short HEAD)\"}"
else
  # Get the hash of all tracked files, modifications, and untracked files (excluding .git and ignored files)x
  current_hash=$(git ls-files -o -c -m --exclude-standard | grep -v ^infrastructure | grep -v ^langevals | xargs cat | sha256sum | cut -d' ' -f1 | cut -c 1-7)
  cd infrastructure
  current_hash_langwatch=$(./scripts/get_langwatch_git_sha.sh | jq -r '.tag')
  echo "{\"tag\": \"$(git rev-parse --short HEAD)-dirty-${current_hash}-${current_hash_langwatch}\"}"
fi

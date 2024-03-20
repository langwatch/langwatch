#!/bin/bash

set -e

cd ../langwatch

if test -z "$(git status --porcelain)"; then
  echo "{\"tag\": \"$(git rev-parse --short HEAD)\"}"
else
  # Get the hash of all tracked files, modifications, and untracked files (excluding .git and ignored files)
  current_hash=$(git ls-files -o -c -m --exclude-standard | grep -v ^python-sdk | grep -v ^langwatch_nlp | xargs cat | sha256sum | cut -d' ' -f1 | cut -c 1-7)
  echo "{\"tag\": \"$(git rev-parse --short HEAD)-dirty-${current_hash}\"}"
fi

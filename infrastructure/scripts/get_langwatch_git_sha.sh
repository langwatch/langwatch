#!/bin/bash

set -e

cd ../langwatch

current_hash=$(git ls-files -o -c -m --exclude-standard | grep -v ^python-sdk | grep -v ^langwatch_nlp | xargs cat | sha256sum | cut -d' ' -f1 | cut -c 1-7)
echo "{\"tag\": \"hash-${current_hash}\", \"git_tag\": \"git-$(git rev-parse --short HEAD)\"}"

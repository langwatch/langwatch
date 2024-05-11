#!/bin/bash

set -e

cd ../langwatch

salt="2024-05-11"
files=$(git ls-files -o -c -m --exclude-standard | grep langwatch_nlp | grep -v ^langwatch_nlp/notebooks | grep -v ^langwatch_nlp/tests | xargs cat)
current_hash=$(printf "%s%s" "$files" "$salt" | sha256sum | cut -d' ' -f1 | cut -c 1-7)
echo "{\"tag\": \"hash-${current_hash}\", \"git_tag\": \"git-$(git rev-parse --short HEAD)\"}"

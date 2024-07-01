#!/bin/bash

set -e

cd ..

salt="2024-07-01 10"
files=$(git ls-files -o -c -m --exclude-standard | grep -v ^infrastructure | grep -v ^langwatch | grep -v ^src/pages/api | grep -v ^langevals | grep -v ^.github | grep -v ^.gitmodules | xargs cat)
# TODO: from some reason this hash still mismatches from mac local to the one in the CI
current_hash=$(printf "%s%s" "$files" "$salt" | sha256sum | cut -d' ' -f1 | cut -c 1-7)
cd infrastructure
current_hash_langwatch=$(./scripts/get_langwatch_git_sha.sh | jq -r '.tag')
echo "{\"tag\": \"hash-${current_hash}-${current_hash_langwatch}\", \"git_tag\": \"git-$(git rev-parse --short HEAD)\"}"

#!/bin/bash

set -e

cd ../langevals

evaluator=$1

global_affecting_files=$(git ls-files -o -c -m --exclude-standard | grep -v ^.github | grep -v ^README.md | grep -v ^evaluators | grep -v ^notebooks | grep -v ^tests | grep -v ^ts-integration)
evaluators_files=$(git ls-files -o -c -m --exclude-standard | grep ^evaluators/$evaluator)
all_files="$global_affecting_files\n$evaluators_files"
current_hash=$(echo -e "$all_files" | xargs cat | sha256sum | cut -d' ' -f1 | cut -c 1-7)
echo "{\"tag\": \"hash-${current_hash}\", \"git_tag\": \"git-$(git rev-parse --short HEAD)\"}"

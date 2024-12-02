#!/bin/bash

set -e

cd ../langevals

evaluator=$1
salt="2024-11-28"
if [ "$evaluator" == "ragas" ]; then
  salt="2024-11-28"
fi

global_affecting_files=$(git ls-files -c -m --exclude-standard | grep -v ^.github | grep -v ^README.md | grep -v ^evaluators | grep -v ^notebooks | grep -v ^tests | grep -v ^ts-integration | grep -v ^poetry.lock)
evaluators_files=$(git ls-files -c -m --exclude-standard | grep ^evaluators/$evaluator)
all_files=$(echo -e "$global_affecting_files\n$evaluators_files" | xargs cat)
current_hash=$(echo "$all_files$salt" | sha256sum | cut -d' ' -f1 | cut -c 1-7)
echo "{\"tag\": \"hash-${current_hash}\", \"git_tag\": \"git-$(git rev-parse --short HEAD)\"}"

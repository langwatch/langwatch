#!/bin/bash

set -e

cd ../langwatch

current_hash=$(git ls-files -o -c -m --exclude-standard | grep -v langwatch_nlp | xargs cat | sha256sum | cut -d' ' -f1 | cut -c 1-7)
echo "{\"tag\": \"${current_hash}\"}"

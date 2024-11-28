#!/bin/bash

set -eo pipefail

file=$1
if [ -z "$file" ]; then
    echo "Please provide a terraform file path"
    exit 1
fi

# Extract resource names using grep and awk
targets=$(./grep_terraform_targets.sh "$file")

# Build the terraform command
cmd="terraform apply $targets"

echo "Running: $cmd"
echo
eval "$cmd"
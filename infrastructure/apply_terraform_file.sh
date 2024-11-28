#!/bin/bash

file=$1
if [ -z "$file" ]; then
    echo "Please provide a terraform file path"
    exit 1
fi

# Extract resource names using grep and awk
resources=$(grep "^resource" "$file" | awk '{print $2 "." $3}' | tr -d '"')

# Build the terraform command
cmd="terraform apply"
for resource in $resources; do
    cmd="$cmd -target=$resource"
done

echo "Running: $cmd"
echo
eval "$cmd"
#!/bin/bash

set -eo pipefail

file=$1
if [ -z "$file" ]; then
    echo "Please provide a terraform file path"
    exit 1
fi

# Extract resource names using grep and awk
resources=$(grep "^resource" "$file" | awk '{print $2 "." $3}' | tr -d '"')
set +e
commented_out_resources=$(grep "^# resource" "$file" | awk '{print $3 "." $4}' | tr -d '"')
set +e
resources="$resources $commented_out_resources"

targets=""
for resource in $resources; do
    targets="$targets -target=$resource"
done

echo "$targets"
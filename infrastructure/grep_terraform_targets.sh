#!/bin/bash

set -eo pipefail

file=$1
if [ -z "$file" ]; then
    echo "Please provide a terraform file path"
    exit 1
fi

# Extract resource names using grep and awk
set +e
resources=$(grep "^resource" "$file" | awk '{print $2 "." $3}' | tr -d '"')
commented_out_resources=$(grep "^# resource" "$file" | awk '{print $3 "." $4}' | tr -d '"')
set -e
resources="$resources $commented_out_resources"

if [ -z "${resources// }" ]; then
    echo "No resources found in $file"
    exit 1
fi

targets=""
for resource in $resources; do
    targets="$targets -target=$resource"
done

echo "$targets"
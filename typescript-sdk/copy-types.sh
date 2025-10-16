#!/bin/bash

set -e

# Function to check if file needs updating
needs_update() {
    local source=$1
    local target=$2
    [[ ! -f "$target" ]] || [[ "$source" -nt "$target" ]]
}

# Copy and generate tracer types if needed
if needs_update ../langwatch/src/server/tracer/types.ts src/internal/generated/types/tracer.ts; then
    cp ../langwatch/src/server/tracer/types.ts src/internal/generated/types/tracer.ts
    ts-to-zod src/internal/generated/types/tracer.ts src/internal/generated/types/tracer.generated.ts
fi

# Copy and generate evaluations types if needed
if needs_update ../langwatch/src/server/evaluations/types.ts src/internal/generated/types/evaluations.ts; then
    cp ../langwatch/src/server/evaluations/types.ts src/internal/generated/types/evaluations.ts
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' 's/\.\.\/tracer\/types\.generated/.\/tracer.generated/g' src/internal/generated/types/evaluations.ts
    else
        sed -i 's/\.\.\/tracer\/types\.generated/.\/tracer.generated/g' src/internal/generated/types/evaluations.ts
    fi
    ts-to-zod src/internal/generated/types/evaluations.ts src/internal/generated/types/evaluations.generated.ts
fi

# Download evaluators if remote file is newer or local doesn't exist
remote_url="https://raw.githubusercontent.com/langwatch/langevals/main/ts-integration/evaluators.generated.ts"
local_file="src/internal/generated/types/evaluators.generated.ts"
if [[ ! -f "$local_file" ]] || [[ $(curl -s -I -L "$remote_url" | grep -i "last-modified:" | cut -d' ' -f2- | xargs) > $(stat -c %y "$local_file" 2>/dev/null || echo "0") ]]; then
    curl -L "$remote_url" -o "$local_file"
    ts-to-zod "$local_file" src/internal/generated/types/evaluators.zod.generated.ts
fi

# Apply fixes (consider moving these upstream)
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' 's/z\.record(z\.never())/z.record(z.string(), z.never())/g' src/internal/generated/types/evaluators.zod.generated.ts
    sed -i '' 's/z\.record(z\.any())/z.record(z.string(), z.any())/g' src/internal/generated/types/tracer.generated.ts
else
    sed -i 's/z\.record(z\.never())/z.record(z.string(), z.never())/g' src/internal/generated/types/evaluators.zod.generated.ts
    sed -i 's/z\.record(z\.any())/z.record(z.string(), z.any())/g' src/internal/generated/types/tracer.generated.ts
fi

#!/bin/bash

set -e

cp ../langwatch/src/server/tracer/types.ts src/internal/generated/types/tracer.ts
ts-to-zod src/internal/generated/types/tracer.ts src/internal/generated/types/tracer.generated.ts

cp ../langwatch/src/server/evaluations/types.ts src/internal/generated/types/evaluations.ts
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' 's/\.\.\/tracer\/types\.generated/.\/tracer.generated/g' src/internal/generated/types/evaluations.ts
else
  sed -i 's/\.\.\/tracer\/types\.generated/.\/tracer.generated/g' src/internal/generated/types/evaluations.ts
fi
ts-to-zod src/internal/generated/types/evaluations.ts src/internal/generated/types/evaluations.generated.ts

cp ../langevals/ts-integration/evaluators.generated.ts src/internal/generated/types/evaluators.generated.ts
ts-to-zod src/internal/generated/types/evaluators.generated.ts src/internal/generated/types/evaluators.zod.generated.ts

# Fix z.record(z.never()) to z.record(z.string(), z.never())
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' 's/z\.record(z\.never())/z.record(z.string(), z.never())/g' src/internal/generated/types/evaluators.zod.generated.ts
  sed -i '' 's/z\.record(z\.any())/z.record(z.string(), z.any())/g' src/internal/generated/types/tracer.generated.ts
else
  sed -i 's/z\.record(z\.never())/z.record(z.string(), z.never())/g' src/internal/generated/types/evaluators.zod.generated.ts
  sed -i 's/z\.record(z\.any())/z.record(z.string(), z.any())/g' src/internal/generated/types/tracer.generated.ts
fi

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

cd src/internal/generated/types/
curl -L "https://raw.githubusercontent.com/langwatch/langevals/main/ts-integration/evaluators.generated.ts?$(date +%s)" -o evaluators.generated.ts
cd -
ts-to-zod src/internal/generated/types/evaluators.generated.ts src/internal/generated/types/evaluators.zod.generated.ts

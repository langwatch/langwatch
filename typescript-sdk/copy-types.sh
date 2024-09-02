set -e

cp ../langwatch/src/server/tracer/types.ts src/server/types/tracer.ts
ts-to-zod src/server/types/tracer.ts src/server/types/tracer.generated.ts

cp ../langwatch/src/server/evaluations/types.ts src/server/types/evaluations.ts
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' 's/\.\.\/tracer\/types\.generated/.\/tracer.generated/g' src/server/types/evaluations.ts
else
  sed -i 's/\.\.\/tracer\/types\.generated/.\/tracer.generated/g' src/server/types/evaluations.ts
fi
ts-to-zod src/server/types/evaluations.ts src/server/types/evaluations.generated.ts

cd src/server/types/
curl -L "https://raw.githubusercontent.com/langwatch/langevals/main/ts-integration/evaluators.generated.ts?$(date +%s)" -o evaluators.generated.ts
cd -
ts-to-zod src/server/types/evaluators.generated.ts src/server/types/evaluators.zod.generated.ts
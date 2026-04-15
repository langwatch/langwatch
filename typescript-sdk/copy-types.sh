#!/bin/bash

set -e

# Copy tracer types (Zod-first — schemas are already in the file)
cp ../langwatch/src/server/tracer/types.ts src/internal/generated/types/tracer.ts

# Copy filter types (only filterFieldsEnum is needed by the SDK)
mkdir -p src/internal/generated/filters
node -e "
const fs = require('fs');
const src = fs.readFileSync('../langwatch/src/server/filters/types.ts', 'utf8');
// Extract only the zod import and filterFieldsEnum definition
const lines = src.split('\n');
const out = [];
let inEnum = false;
for (const line of lines) {
  if (line.match(/^import.*from ['\"]zod['\"]/)) { out.push(line); continue; }
  if (line.match(/export const filterFieldsEnum/)) { inEnum = true; }
  if (inEnum) { out.push(line); }
  if (inEnum && line.includes(']);')) { inEnum = false; }
  if (line.match(/export type FilterField/)) { out.push(line); }
}
fs.writeFileSync('src/internal/generated/filters/types.ts', out.join('\n') + '\n');
"

# Copy evaluations types (Zod-first)
cp ../langwatch/src/server/evaluations/types.ts src/internal/generated/types/evaluations.ts
# Fix import path from ../tracer/types to ./tracer
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' 's/\.\.\/tracer\/types/\.\/tracer/g' src/internal/generated/types/evaluations.ts
else
  sed -i 's/\.\.\/tracer\/types/\.\/tracer/g' src/internal/generated/types/evaluations.ts
fi

# Copy evaluators generated (Zod schemas are already in the file)
cp ../langevals/ts-integration/evaluators.generated.ts src/internal/generated/types/evaluators.generated.ts

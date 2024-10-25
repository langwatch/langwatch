generate_tracer_types() {
  ts-to-zod src/server/tracer/types.ts src/server/tracer/types.generated.ts
  if [ "$(uname)" = "Darwin" ]; then
    cat src/server/tracer/types.generated.ts | sed -i '' 's/import { SpanInputOutput }/import { type SpanInputOutput }/' src/server/tracer/types.generated.ts
  else
    cat src/server/tracer/types.generated.ts | sed -i 's/import { SpanInputOutput }/import { type SpanInputOutput }/' src/server/tracer/types.generated.ts
  fi
}

generate_evaluations_types() {
  ts-to-zod src/server/evaluations/types.ts src/server/evaluations/types.generated.ts
}

generate_evaluators_types() {
  # Fix for @default false not being parsed correctly by ts-to-zod
  cat src/server/evaluations/evaluators.generated.ts | sed 's/@default false/@default "false"/' >src/server/evaluations/evaluators.temp.generated.ts
  ts-to-zod src/server/evaluations/evaluators.temp.generated.ts src/server/evaluations/evaluators.zod.generated.ts
  rm src/server/evaluations/evaluators.temp.generated.ts

  if [ "$(uname)" = "Darwin" ]; then
    # Fix for zod not parsing the default values correctly for arrays and objects https://github.com/fabien0102/ts-to-zod/issues/111
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i '' "s/'{/{/" src/server/evaluations/evaluators.zod.generated.ts
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i '' "s/}'/}/" src/server/evaluations/evaluators.zod.generated.ts
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i '' "s/'\[/[/" src/server/evaluations/evaluators.zod.generated.ts
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i '' "s/\]'/]/" src/server/evaluations/evaluators.zod.generated.ts
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i '' 's/("false")/(false)/g' src/server/evaluations/evaluators.zod.generated.ts
  else
    # Fix for zod not parsing the default values correctly for arrays and objects https://github.com/fabien0102/ts-to-zod/issues/111
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i "s/'{/{/" src/server/evaluations/evaluators.zod.generated.ts
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i "s/}'/}/" src/server/evaluations/evaluators.zod.generated.ts
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i "s/'\[/[/" src/server/evaluations/evaluators.zod.generated.ts
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i "s/\]'/]/" src/server/evaluations/evaluators.zod.generated.ts
    cat src/server/evaluations/evaluators.zod.generated.ts | sed -i 's/("false")/(false)/g' src/server/evaluations/evaluators.zod.generated.ts
  fi
}

generate_datasets_types() {
  ts-to-zod src/server/datasets/types.ts src/server/datasets/types.generated.ts
}

generate_experiments_types() {
  ts-to-zod src/server/experiments/types.ts src/server/experiments/types.generated.ts
}

# Make script exit on any errors
# set -eo pipefail
set -e

# Run all generators in parallel and store their PIDs
generate_tracer_types &
pid1=$!
generate_evaluations_types &
pid2=$!
generate_evaluators_types &
pid3=$!
generate_datasets_types &
pid4=$!
generate_experiments_types &
pid5=$!

# Wait for each process and check its exit status
wait $pid1 || exit 1
wait $pid2 || exit 1
wait $pid3 || exit 1
wait $pid4 || exit 1
wait $pid5 || exit 1

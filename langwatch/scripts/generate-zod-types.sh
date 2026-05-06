#!/bin/sh

# Retry helper: re-runs a function up to 3 times with backoff. ts-to-zod
# spawns its own worker_thread + ts-node JIT cold-start under the hood,
# and when 4 generators fork simultaneously (see the parallel `&` block
# below) the worker init handshake races a 10s timeout
# ("Did not receive an init message from worker after 10000ms"). The
# parallel form is faster on warm runs, so keep it — but wrap each
# generator so a single cold-start collision doesn't crashloop the
# entrypoint chain.
#
# ts-to-zod is deterministic: 3 failures in a row means a real error,
# not a flake — exit hard so the operator sees the underlying issue.
retry() {
  fn="$1"
  attempt=1
  max=3
  while [ "$attempt" -le "$max" ]; do
    if "$fn"; then
      return 0
    fi
    if [ "$attempt" -lt "$max" ]; then
      echo "[generate-zod-types] $fn failed on attempt $attempt — retrying in $((attempt * 2))s" >&2
      sleep $((attempt * 2))
    fi
    attempt=$((attempt + 1))
  done
  echo "[generate-zod-types] $fn failed after $max attempts" >&2
  return 1
}

generate_tracer_types() {
  ts-to-zod src/server/tracer/types.ts src/server/tracer/types.generated.ts
  if [ "$(uname)" = "Darwin" ]; then
    cat src/server/tracer/types.generated.ts | sed -i '' 's/import { SpanInputOutput }/import { type SpanInputOutput }/' src/server/tracer/types.generated.ts
  else
    cat src/server/tracer/types.generated.ts | sed -i 's/import { SpanInputOutput }/import { type SpanInputOutput }/' src/server/tracer/types.generated.ts
  fi
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

# Run all generators in parallel and store their PIDs. Each is wrapped
# in `retry` so a worker_thread init handshake collision doesn't kill
# the entrypoint chain — see retry() at the top of this file.
retry generate_tracer_types &
pid1=$!
retry generate_evaluators_types &
pid2=$!
retry generate_datasets_types &
pid3=$!
retry generate_experiments_types &
pid4=$!

# Wait for each process and check its exit status
wait $pid1 || exit 1
wait $pid2 || exit 1
wait $pid3 || exit 1
wait $pid4 || exit 1

#!/usr/bin/env bats
# Unit tests for the soft Go-runtime memory cap check-queue sets on the runs it
# spawns (specs/setup/haven-tsgo-governor.feature, ADR-095). The child echoes
# its own environment, so the tests observe what a wrapped tsgo would actually
# receive. CHECK_SLOTS is set high so the queue admits instantly and the tests
# never wait on real slot contention.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

# @scenario "Queued whole-tree runs get a soft memory cap at spawn"
@test "a spawned run receives a machine-sized GOMEMLIMIT" {
  run env CHECK_SLOTS=99 GOMEMLIMIT= node "$SCRIPT_DIR/check-queue.mjs" \
    node -e 'process.stdout.write(process.env.GOMEMLIMIT || "unset")'
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9]+GiB$ ]]
}

@test "an operator's explicit GOMEMLIMIT is never overridden" {
  run env CHECK_SLOTS=99 GOMEMLIMIT=123MiB node "$SCRIPT_DIR/check-queue.mjs" \
    node -e 'process.stdout.write(process.env.GOMEMLIMIT || "unset")'
  [ "$status" -eq 0 ]
  [ "$output" = "123MiB" ]
}

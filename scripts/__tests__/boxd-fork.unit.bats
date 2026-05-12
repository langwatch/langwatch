#!/usr/bin/env bats
# Unit tests for scripts/boxd/boxd-fork.sh pure functions.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  source "$SCRIPT_DIR/boxd/boxd-fork.sh"
}

# --- derive_fork_name ---

@test "derive_fork_name: uses pr-N when forking the default golden" {
  result=$(derive_fork_name "1234")
  [ "$result" = "pr-1234" ]
}

@test "derive_fork_name: explicit default golden is the same as omitted" {
  result=$(derive_fork_name "1234" "langwatch-main")
  [ "$result" = "pr-1234" ]
}

@test "derive_fork_name: appends suffix from a personal golden" {
  result=$(derive_fork_name "1234" "langwatch-main-alice")
  [ "$result" = "pr-1234-alice" ]
}

@test "derive_fork_name: falls back to full name when no langwatch-main- prefix" {
  result=$(derive_fork_name "1234" "experimental")
  [ "$result" = "pr-1234-experimental" ]
}

# --- derive_hostname ---

@test "derive_hostname: appends .boxd.sh to a fork name" {
  result=$(derive_hostname "pr-1234")
  [ "$result" = "pr-1234.boxd.sh" ]
}

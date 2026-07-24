#!/usr/bin/env bats
# Unit tests for worktree.sh pure functions

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  source "$SCRIPT_DIR/worktree.sh"
}

# --- generate_slug ---

@test "generate_slug: derives slug from issue title" {
  result=$(generate_slug "Pre-suite scenario runs missing from all-runs")
  [ "$result" = "pre-suite-scenario-runs-missing-from-all-runs" ]
}

@test "generate_slug: truncates long slug at word boundary" {
  result=$(generate_slug "This is a very long issue title that exceeds the maximum allowed slug length")
  # Slug must be significantly shorter than original (76 chars) and truncated at word boundary
  [ "${#result}" -le 50 ]
  [ "${#result}" -lt 76 ]
}

@test "generate_slug: truncated slug does not end with a hyphen" {
  result=$(generate_slug "This is a very long issue title that exceeds the maximum allowed slug length")
  [[ "$result" != *- ]]
}

@test "generate_slug: strips special characters" {
  result=$(generate_slug "Fix: user's data (broken) #123")
  # Only lowercase letters, numbers, and hyphens
  [[ "$result" =~ ^[a-z0-9-]+$ ]]
}

# --- build_branch_name ---

@test "build_branch_name: builds branch name from issue number" {
  result=$(build_branch_name "1663" "pre-suite-scenario-runs-missing-from-all-runs")
  [ "$result" = "issue1663/pre-suite-scenario-runs-missing-from-all-runs" ]
}

@test "build_branch_name: builds branch name from feature name" {
  result=$(build_branch_name "add-dark-mode")
  [ "$result" = "feat/add-dark-mode" ]
}

# --- derive_directory ---

@test "derive_directory: derives directory from issue branch" {
  result=$(derive_directory "issue1663/pre-suite-scenario-runs-missing-from-all-runs")
  [ "$result" = ".worktrees/issue1663-pre-suite-scenario-runs-missing-from-all-runs" ]
}

@test "derive_directory: derives directory from feature branch" {
  result=$(derive_directory "feat/add-dark-mode")
  [ "$result" = ".worktrees/feat-add-dark-mode" ]
}

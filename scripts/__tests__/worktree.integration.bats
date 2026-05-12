#!/usr/bin/env bats
# Integration tests for worktree.sh
# Mocks git and gh commands to test the script's orchestration.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT="$SCRIPT_DIR/worktree.sh"

setup() {
  # Create a temp directory for test isolation
  TEST_DIR="$(mktemp -d)"
  MOCK_BIN="$TEST_DIR/bin"
  mkdir -p "$MOCK_BIN"

  # Track commands that were called
  CALL_LOG="$TEST_DIR/calls.log"
  touch "$CALL_LOG"

  # Default mock for git
  cat > "$MOCK_BIN/git" << 'MOCKEOF'
#!/bin/bash
echo "git $*" >> "$CALL_LOG"
case "$1" in
  fetch) exit 0 ;;
  ls-remote)
    if [ -f "$TEST_DIR/remote_branch_exists" ]; then
      echo "abc123	refs/heads/$4"
      exit 0
    else
      exit 2
    fi
    ;;
  worktree)
    # Create the directory so .env copy and pnpm install work
    if [ "$2" = "add" ]; then
      shift 2  # skip 'worktree add'
      # Skip -b flag and its branch argument
      if [ "${1:-}" = "-b" ]; then
        shift 2
      fi
      # First remaining arg is always the directory
      if [ -n "${1:-}" ]; then
        mkdir -p "$1"
      fi
    fi
    exit 0
    ;;
  *) exit 0 ;;
esac
MOCKEOF
  chmod +x "$MOCK_BIN/git"

  # Default mock for pnpm
  cat > "$MOCK_BIN/pnpm" << 'MOCKEOF'
#!/bin/bash
echo "pnpm $*" >> "$CALL_LOG"
exit 0
MOCKEOF
  chmod +x "$MOCK_BIN/pnpm"

  # Default mock for gh
  cat > "$MOCK_BIN/gh" << 'MOCKEOF'
#!/bin/bash
echo "gh $*" >> "$CALL_LOG"
if [ -f "$TEST_DIR/gh_title" ]; then
  cat "$TEST_DIR/gh_title"
else
  echo "Mock Issue Title"
fi
MOCKEOF
  chmod +x "$MOCK_BIN/gh"

  # Prepend mock bin to PATH
  export PATH="$MOCK_BIN:$PATH"
  export CALL_LOG
  export TEST_DIR

  # Work from a temp working directory
  WORK_DIR="$TEST_DIR/repo"
  mkdir -p "$WORK_DIR"
  cd "$WORK_DIR"
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "creates worktree from issue number with new branch" {
  echo "Pre-suite scenario runs missing from all-runs" > "$TEST_DIR/gh_title"

  run bash "$SCRIPT" 1663
  [ "$status" -eq 0 ]

  # Verify worktree add was called with correct branch and directory
  grep -q "git worktree add -b issue1663/pre-suite-scenario-runs-missing-from-all-runs .worktrees/issue1663-pre-suite-scenario-runs-missing-from-all-runs origin/main" "$CALL_LOG"
}

@test "creates worktree from feature name" {
  run bash "$SCRIPT" add-dark-mode
  [ "$status" -eq 0 ]

  grep -q "git worktree add -b feat/add-dark-mode .worktrees/feat-add-dark-mode origin/main" "$CALL_LOG"
}

@test "checks out existing remote branch" {
  echo "Pre-suite scenario runs missing from all-runs" > "$TEST_DIR/gh_title"
  touch "$TEST_DIR/remote_branch_exists"

  run bash "$SCRIPT" 1663
  [ "$status" -eq 0 ]

  # Should use plain 'worktree add' without -b (tracking existing)
  grep -q "git worktree add .worktrees/issue1663-pre-suite-scenario-runs-missing-from-all-runs issue1663/pre-suite-scenario-runs-missing-from-all-runs" "$CALL_LOG"
}

@test "copies .env files to new worktree" {
  # Create .env files in working directory
  echo "DB_URL=test" > .env
  echo "LOCAL_KEY=val" > .env.local

  run bash "$SCRIPT" add-dark-mode
  [ "$status" -eq 0 ]

  # Check .env files were copied
  [ -f ".worktrees/feat-add-dark-mode/.env" ]
  [ -f ".worktrees/feat-add-dark-mode/.env.local" ]
}

@test "succeeds when no .env files exist" {
  # No .env files in the working directory
  run bash "$SCRIPT" add-dark-mode
  [ "$status" -eq 0 ]
}

@test "exits when worktree directory already exists" {
  # Pre-create the directory
  mkdir -p ".worktrees/feat-add-dark-mode"

  run bash "$SCRIPT" add-dark-mode
  [ "$status" -ne 0 ]
  [[ "$output" == *".worktrees/feat-add-dark-mode"* ]]
}

@test "prints summary with issue URL and runs pnpm install" {
  echo "Pre-suite scenario runs missing from all-runs" > "$TEST_DIR/gh_title"

  run bash "$SCRIPT" 1663
  [ "$status" -eq 0 ]

  # Check output includes branch name
  [[ "$output" == *"issue1663/pre-suite-scenario-runs-missing-from-all-runs"* ]]
  # Check absolute path
  [[ "$output" == *"$WORK_DIR/.worktrees/issue1663-pre-suite-scenario-runs-missing-from-all-runs"* ]]
  # Check issue URL
  [[ "$output" == *"https://github.com/langwatch/langwatch/issues/1663"* ]]
  # Check pnpm install was executed
  grep -q "pnpm install" "$CALL_LOG"
}

@test "prints summary without issue URL for feature worktrees" {
  run bash "$SCRIPT" add-dark-mode
  [ "$status" -eq 0 ]

  [[ "$output" == *"feat/add-dark-mode"* ]]
  [[ "$output" == *".worktrees/feat-add-dark-mode"* ]]
  # Should NOT include issue URL
  [[ "$output" != *"https://github.com/langwatch/langwatch/issues/"* ]]
}

@test "fails when gh CLI is not available for issue input" {
  # The script checks 'command -v gh'. We can't remove gh from PATH since
  # it lives in /usr/bin. Instead, shadow it with a script that makes
  # 'command -v' succeed but we test via an env var the script checks.
  # Simpler approach: create a wrapper that unsets gh by aliasing to false.
  local no_gh_dir="$TEST_DIR/no_gh_bin"
  mkdir -p "$no_gh_dir"
  # Copy git mock
  cp "$MOCK_BIN/git" "$no_gh_dir/git"
  # Do NOT provide gh at all; use a PATH that excludes /usr/bin
  # We need basic utils so copy them
  cp "$MOCK_BIN/pnpm" "$no_gh_dir/pnpm"
  for cmd in bash sed tr printf mkdir cp ls cat; do
    ln -sf "$(which "$cmd")" "$no_gh_dir/$cmd"
  done

  local wrapper="$TEST_DIR/run_no_gh.sh"
  printf '#!/usr/bin/env bash\nexport PATH="%s"\nexec "%s/bash" "%s" 1663\n' "$no_gh_dir" "$no_gh_dir" "$SCRIPT" > "$wrapper"
  chmod +x "$wrapper"

  run "$wrapper"
  [ "$status" -ne 0 ]
  [[ "$output" == *"gh CLI"* ]]
}

@test "fails when no argument is provided" {
  run bash "$SCRIPT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "fetches from origin before creating worktree" {
  run bash "$SCRIPT" add-dark-mode
  [ "$status" -eq 0 ]

  # git fetch origin should appear in log BEFORE worktree add
  local fetch_line
  fetch_line=$(grep -n "git fetch origin" "$CALL_LOG" | head -1 | cut -d: -f1)
  local worktree_line
  worktree_line=$(grep -n "git worktree add" "$CALL_LOG" | head -1 | cut -d: -f1)
  [ "$fetch_line" -lt "$worktree_line" ]
}

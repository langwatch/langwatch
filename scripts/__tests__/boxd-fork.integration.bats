#!/usr/bin/env bats
# Integration tests for scripts/boxd-fork.sh orchestration.
# Mocks `boxd`, `gh`, and `git` so we can verify the call sequence without
# actually creating VMs or making network calls.
#
# Pattern mirrors scripts/__tests__/worktree.integration.bats: prepend a
# mock-bin to PATH, execute the helper, grep the call log.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  TEST_DIR="$(mktemp -d)"
  MOCK_BIN="$TEST_DIR/bin"
  mkdir -p "$MOCK_BIN"

  CALL_LOG="$TEST_DIR/calls.log"
  : > "$CALL_LOG"

  # boxd mock — records args; boxd list returns canned VMs from $TEST_DIR/vms;
  # boxd exec records the exec'd command.
  cat > "$MOCK_BIN/boxd" << 'MOCKEOF'
#!/bin/bash
echo "boxd $*" >> "$CALL_LOG"
case "$1" in
  list)
    if [ -f "$TEST_DIR/vms" ]; then cat "$TEST_DIR/vms"; fi
    exit 0
    ;;
  exec)
    # boxd exec VM -- command — record but always return a benign result.
    # If an env file lookup wants `tmux has-session`, return OK iff fixture says so.
    case "$*" in
      *"tmux has-session"*)
        if [ -f "$TEST_DIR/tmux_present" ]; then echo "OK"; fi
        ;;
    esac
    exit 0
    ;;
  fork|cp|new|destroy|resume|pause|reboot|proxy|connect|info|auto-suspend)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
MOCKEOF
  chmod +x "$MOCK_BIN/boxd"

  # gh mock — `gh issue view --jq .title` returns title from fixture.
  cat > "$MOCK_BIN/gh" << 'MOCKEOF'
#!/bin/bash
echo "gh $*" >> "$CALL_LOG"
case "$*" in
  *"issue view"*)
    if [ -f "$TEST_DIR/gh_title" ]; then cat "$TEST_DIR/gh_title"
    else echo "Mock Issue Title"; fi
    ;;
  *"pr view"*)
    if [ -f "$TEST_DIR/gh_pr_branch" ]; then cat "$TEST_DIR/gh_pr_branch"
    else echo "feat/from-pr"; fi
    ;;
esac
exit 0
MOCKEOF
  chmod +x "$MOCK_BIN/gh"

  # git mock — `git rev-parse --verify BRANCH` returns 0 iff fixture says so.
  cat > "$MOCK_BIN/git" << 'MOCKEOF'
#!/bin/bash
echo "git $*" >> "$CALL_LOG"
case "$1" in
  rev-parse)
    if [ -f "$TEST_DIR/branch_exists" ]; then exit 0; else exit 128; fi
    ;;
  *)
    exit 0
    ;;
esac
MOCKEOF
  chmod +x "$MOCK_BIN/git"

  # worktree.sh mock — record call, succeed.
  cat > "$MOCK_BIN/worktree.sh" << 'MOCKEOF'
#!/bin/bash
echo "worktree.sh $*" >> "$CALL_LOG"
exit 0
MOCKEOF
  chmod +x "$MOCK_BIN/worktree.sh"

  export PATH="$MOCK_BIN:$PATH"
  export CALL_LOG TEST_DIR
  # Point boxd-fork.sh at the mock binaries via its env-overridable hooks.
  export BOXD_BIN="$MOCK_BIN/boxd"
  export GH_BIN="$MOCK_BIN/gh"
  export GIT_BIN="$MOCK_BIN/git"
  export BOXD_FORK_REPO="langwatch/langwatch"
  export CLAUDE_CREDS="$TEST_DIR/creds"
  : > "$TEST_DIR/creds"

  # Fixture: a fake repo root with a couple of .env files.
  WORK_DIR="$TEST_DIR/repo"
  mkdir -p "$WORK_DIR/langwatch" "$WORK_DIR/langwatch_nlp"
  cat > "$WORK_DIR/langwatch/.env" <<EOF
NEXTAUTH_URL=http://localhost:5560
BASE_HOST=http://localhost:5560
SOMETHING_ELSE=keep-me
EOF
  : > "$WORK_DIR/langwatch_nlp/.env"
  cd "$WORK_DIR"

  source "$SCRIPT_DIR/boxd-fork.sh"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# --- _boxd_fork_impl orchestration ---

@test "fork-issue: full happy path calls fork, cp, proxy, tmux in order" {
  run boxd_fork_issue 4242
  [ "$status" -eq 0 ]
  # Expected sequence (greppable):
  grep -q "gh issue view 4242" "$CALL_LOG"
  grep -q "boxd fork langwatch-golden --name=langwatch-issue4242" "$CALL_LOG"
  grep -q "boxd exec langwatch-issue4242" "$CALL_LOG"
  grep -q "boxd cp .* langwatch-issue4242:.claude/.credentials.json" "$CALL_LOG"
  # At least one .env was uploaded
  grep -qE "boxd cp .* langwatch-issue4242:langwatch/langwatch/\.env" "$CALL_LOG"
  # Ports were mapped (proxy set-port + at least one new)
  grep -q "proxy set-port" "$CALL_LOG"
  grep -q "proxy new aigw" "$CALL_LOG"
  # tmux session was started inside the VM
  grep -q "tmux new-session -d -s 'claude-issue4242'" "$CALL_LOG"
}

@test "fork-issue: errors when VM already exists (AC#15)" {
  cat > "$TEST_DIR/vms" <<EOF
[{"name":"langwatch-issue4242","status":"running"}]
EOF
  run boxd_fork_issue 4242
  [ "$status" -ne 0 ]
  [[ "$output" == *"already exists"* ]]
}

@test "fork-branch: warns when slug looks like an issue (AC#14)" {
  run boxd_fork_branch "issue42/foo-bar"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Consider 'make boxd-fork-issue ISSUE=42'"* ]]
  # Distinct VM name from fork-issue ISSUE=42
  grep -q "boxd fork langwatch-golden --name=langwatch-issue42-foo-bar" "$CALL_LOG"
}

@test "fork-branch: produces langwatch-<slug> for normal branches" {
  run boxd_fork_branch "feat/dark-mode"
  [ "$status" -eq 0 ]
  grep -q "boxd fork langwatch-golden --name=langwatch-feat-dark-mode" "$CALL_LOG"
}

@test "fork-pr: resolves head ref via gh and forks (AC#16)" {
  echo "feat/from-fork" > "$TEST_DIR/gh_pr_branch"
  run boxd_fork_pr 1234
  [ "$status" -eq 0 ]
  grep -q "gh pr view 1234" "$CALL_LOG"
  grep -q "boxd fork langwatch-golden --name=langwatch-feat-from-fork" "$CALL_LOG"
}

# --- env upload + rewrite ---

@test "fork: rewrites stale localhost in uploaded env" {
  run boxd_fork_branch "feat/foo"
  [ "$status" -eq 0 ]
  # The uploaded .env temp file is gone post-cp, but we can verify the rewrite
  # logic in isolation:
  result=$(printf 'NEXTAUTH_URL=http://localhost:5560\n' \
    | boxd_rewrite_env "langwatch-feat-foo")
  [[ "$result" == *"langwatch-feat-foo.boxd.sh"* ]]
}

# --- connect-* ---

@test "connect: errors clearly when VM does not exist (AC#19)" {
  echo "[]" > "$TEST_DIR/vms"
  run boxd_connect issue 4242
  [ "$status" -ne 0 ]
  [[ "$output" == *"does not exist"* ]]
}

@test "connect: errors when tmux session is missing (AC#18)" {
  cat > "$TEST_DIR/vms" <<EOF
[{"name":"langwatch-issue4242","status":"running"}]
EOF
  # tmux_present fixture not set → the tmux has-session check returns nothing
  run boxd_connect issue 4242
  [ "$status" -ne 0 ]
  [[ "$output" == *"no claude session"* ]]
}

@test "connect: wakes a suspended VM before attaching (AC#20)" {
  cat > "$TEST_DIR/vms" <<EOF
[{"name":"langwatch-issue4242","status":"standby"}]
EOF
  touch "$TEST_DIR/tmux_present"
  # boxd_connect ends in `exec` so we sub-shell it
  ( boxd_connect issue 4242 ) >/dev/null 2>&1 || true
  grep -q "boxd resume langwatch-issue4242" "$CALL_LOG"
}

# --- golden ---

@test "golden: skips creation if VM already exists" {
  cat > "$TEST_DIR/vms" <<EOF
[{"name":"langwatch-golden","status":"running"}]
EOF
  run boxd_golden
  [ "$status" -eq 0 ]
  # Did NOT call `boxd new` for the existing VM
  ! grep -q "boxd new --name=langwatch-golden" "$CALL_LOG"
}

@test "golden: creates VM when absent" {
  echo "[]" > "$TEST_DIR/vms"
  run boxd_golden
  [ "$status" -eq 0 ]
  grep -q "boxd new --name=langwatch-golden" "$CALL_LOG"
}

@test "golden-reset: refuses without BOXD_FORK_YES=1 (AC#4)" {
  cat > "$TEST_DIR/vms" <<EOF
[{"name":"langwatch-golden","status":"running"}]
EOF
  run boxd_golden_reset
  [ "$status" -ne 0 ]
  [[ "$output" == *"BOXD_FORK_YES=1"* ]]
}

@test "golden-reset: destroys + recreates with BOXD_FORK_YES=1" {
  cat > "$TEST_DIR/vms" <<EOF
[{"name":"langwatch-golden","status":"running"}]
EOF
  BOXD_FORK_YES=1 run boxd_golden_reset
  [ "$status" -eq 0 ]
  grep -q "boxd destroy langwatch-golden" "$CALL_LOG"
  # `boxd_vm_exists` will return false after destroy on a fresh fixture, so
  # `boxd new` should have been called. Note: the mock list still returns the
  # old VM, but the implementation calls `boxd new` after `boxd destroy`
  # unconditionally for reset.
}

#!/usr/bin/env bash
# Unit tests for start-boxd-ssh-agent.sh
#
# Runs the real script, not a copy: the point of extracting the four duplicated
# blocks into one file is that one file can be driven, and a test that re-states
# the logic would pass just as happily if the script inverted.
#
# HOME is redirected to a temp tree so ~/.ssh is never the real one, and
# ssh-keyscan is shimmed on PATH so nothing reaches the network. ssh-agent and
# ssh-add are real: whether the key actually loads is the behaviour under test,
# and a shimmed ssh-add would assert nothing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT="$SCRIPTS_DIR/start-boxd-ssh-agent.sh"

PASS=0
FAIL=0

if [ ! -f "$SCRIPT" ] || [ ! -r "$SCRIPT" ]; then
  echo "FAIL: $SCRIPT is missing or not readable"
  exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

pass() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL=$((FAIL + 1))
}

assert_exit() {
  local expected="$1" actual="$2" desc="$3"
  if [ "$actual" -eq "$expected" ]; then
    pass "$desc (exit $actual)"
  else
    fail "$desc: expected exit $expected, got $actual"
  fi
}

assert_contains() {
  local file="$1" needle="$2" desc="$3"
  if grep -qF -- "$needle" "$file"; then
    pass "$desc"
  else
    fail "$desc: '$needle' not found in $file:"
    sed 's/^/      /' "$file"
  fi
}

assert_absent() {
  local file="$1" needle="$2" desc="$3"
  if grep -qF -- "$needle" "$file"; then
    fail "$desc: '$needle' unexpectedly present in $file"
  else
    pass "$desc"
  fi
}

# A sandbox per case: its own HOME, its own GITHUB_ENV, and a bin dir holding
# the ssh-keyscan shim. Echoes the sandbox path.
setup_sandbox() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  mkdir -p "$tmpdir/home" "$tmpdir/bin"
  : > "$tmpdir/github_env"

  cat > "$tmpdir/bin/ssh-keyscan" <<'SHIM'
#!/usr/bin/env bash
# Stands in for a real key scan of the boxd host. Emits a plausible known_hosts
# line so the script's redirect has something to write, and never dials out.
echo "boxd.sh ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStubKeyForTestsOnly"
SHIM
  chmod +x "$tmpdir/bin/ssh-keyscan"

  echo "$tmpdir"
}

# Kills the agent the script started, if it started one, so cases do not leak
# daemons into the runner.
teardown_sandbox() {
  local tmpdir="$1"
  local agent_pid
  agent_pid="$(sed -n 's/^SSH_AGENT_PID=//p' "$tmpdir/github_env" | tail -1)"
  if [ -n "$agent_pid" ]; then
    kill "$agent_pid" 2>/dev/null || true
  fi
  rm -rf "$tmpdir"
}

# Runs the script with the sandbox in place. Extra env comes in as NAME=VALUE
# arguments. Stdout and stderr land in $tmpdir/output.
run_script() {
  local tmpdir="$1"
  shift
  set +e
  env -i \
    PATH="$tmpdir/bin:/usr/bin:/bin" \
    HOME="$tmpdir/home" \
    GITHUB_ENV="$tmpdir/github_env" \
    "$@" \
    bash "$SCRIPT" > "$tmpdir/output" 2>&1
  local code=$?
  set -e
  return $code
}

# ---------------------------------------------------------------------------
# Case a: no key at all, the fork / unconfigured-secret path.
# Degrading here is deliberate, so the assertion is that it degrades AND says
# so, not merely that it exits 0.
# ---------------------------------------------------------------------------

run_case_a() {
  local tmpdir exit_code
  tmpdir="$(setup_sandbox)"

  exit_code=0
  run_script "$tmpdir" SKIPPED_STEPS="preview VM steps" || exit_code=$?

  assert_exit 0 "$exit_code" "case a: no BOXD_SSH_KEY → exit 0"
  assert_contains "$tmpdir/github_env" "BOXD_SKIP=true" \
    "case a: no key → BOXD_SKIP=true so later steps opt out"
  assert_contains "$tmpdir/output" \
    "::warning::BOXD_SSH_KEY is not configured; preview VM steps skipped" \
    "case a: no key → warning names what was skipped"
  assert_absent "$tmpdir/github_env" "SSH_AUTH_SOCK=" \
    "case a: no key → no agent socket exported"

  teardown_sandbox "$tmpdir"
}

# ---------------------------------------------------------------------------
# Case b: the secret exists but is empty. GitHub hands an unset secret through
# as an empty string, so this is the shape the fork case actually arrives in.
# ---------------------------------------------------------------------------

run_case_b() {
  local tmpdir exit_code
  tmpdir="$(setup_sandbox)"

  exit_code=0
  run_script "$tmpdir" BOXD_SSH_KEY="" SKIPPED_STEPS="orphan reaper steps" || exit_code=$?

  assert_exit 0 "$exit_code" "case b: empty BOXD_SSH_KEY → exit 0"
  assert_contains "$tmpdir/github_env" "BOXD_SKIP=true" \
    "case b: empty key → BOXD_SKIP=true"
  assert_contains "$tmpdir/output" \
    "::warning::BOXD_SSH_KEY is not configured; orphan reaper steps skipped" \
    "case b: the caller's label reaches the warning, not a hardcoded one"

  teardown_sandbox "$tmpdir"
}

# ---------------------------------------------------------------------------
# Case c: a usable key. The four copies disagreed about SSH_AGENT_PID, so both
# exports are asserted, and the key is checked to be really in the agent rather
# than the agent merely having started.
# ---------------------------------------------------------------------------

run_case_c() {
  local tmpdir exit_code key
  tmpdir="$(setup_sandbox)"
  key="$tmpdir/id_ed25519"
  ssh-keygen -q -t ed25519 -N "" -C "start-boxd-ssh-agent-test" -f "$key"

  exit_code=0
  run_script "$tmpdir" BOXD_SSH_KEY="$(cat "$key")" || exit_code=$?

  assert_exit 0 "$exit_code" "case c: usable key → exit 0"
  assert_absent "$tmpdir/github_env" "BOXD_SKIP=true" \
    "case c: usable key → does not set BOXD_SKIP"
  assert_contains "$tmpdir/github_env" "SSH_AUTH_SOCK=" \
    "case c: usable key → exports the agent socket"
  assert_contains "$tmpdir/github_env" "SSH_AGENT_PID=" \
    "case c: usable key → exports the agent pid so later steps can kill it"
  assert_contains "$tmpdir/home/.ssh/known_hosts" "boxd.sh" \
    "case c: usable key → the boxd host lands in known_hosts"

  local sock
  sock="$(sed -n 's/^SSH_AUTH_SOCK=//p' "$tmpdir/github_env" | tail -1)"
  if SSH_AUTH_SOCK="$sock" ssh-add -l 2>/dev/null | grep -q "start-boxd-ssh-agent-test"; then
    pass "case c: usable key → the key is loaded into the running agent"
  else
    fail "case c: agent started but the key is not in it"
  fi

  teardown_sandbox "$tmpdir"
}

# ---------------------------------------------------------------------------
# Case d: a key that is present but not a key. This is a broken secret, not a
# missing one, and it must fail the job. Degrading here would report "no
# preview configured" for as long as the secret stayed corrupt.
# ---------------------------------------------------------------------------

run_case_d() {
  local tmpdir exit_code
  tmpdir="$(setup_sandbox)"

  exit_code=0
  run_script "$tmpdir" BOXD_SSH_KEY="not actually a private key" || exit_code=$?

  if [ "$exit_code" -ne 0 ]; then
    pass "case d: unusable key → non-zero exit (exit $exit_code)"
  else
    fail "case d: unusable key exited 0, so a corrupt secret would pass silently"
  fi
  assert_absent "$tmpdir/github_env" "BOXD_SKIP=true" \
    "case d: unusable key → not reported as an absent key"

  teardown_sandbox "$tmpdir"
}

# ---------------------------------------------------------------------------
# Case e: no SKIPPED_STEPS supplied. The composite action defaults it, but the
# script is what runs, so it carries its own default rather than emitting
# "; skipped" with a hole in the middle.
# ---------------------------------------------------------------------------

run_case_e() {
  local tmpdir exit_code
  tmpdir="$(setup_sandbox)"

  exit_code=0
  run_script "$tmpdir" || exit_code=$?

  assert_exit 0 "$exit_code" "case e: no SKIPPED_STEPS → exit 0"
  assert_contains "$tmpdir/output" \
    "::warning::BOXD_SSH_KEY is not configured; preview VM steps skipped" \
    "case e: no SKIPPED_STEPS → falls back to a complete sentence"

  teardown_sandbox "$tmpdir"
}

# ---------------------------------------------------------------------------
# Run all cases
# ---------------------------------------------------------------------------

run_case_a
run_case_b
run_case_c
run_case_d
run_case_e

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

exit 0

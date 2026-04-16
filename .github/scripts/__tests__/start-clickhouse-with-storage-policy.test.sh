#!/usr/bin/env bash
# Unit tests for start-clickhouse-with-storage-policy.sh
# Shims curl and docker so no real containers or network are needed.
# Each test programs a sequence of curl exit codes via READY_SEQUENCE / VERIFY_SEQUENCE
# env vars written to temp files consumed by the curl shim.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT="$SCRIPTS_DIR/start-clickhouse-with-storage-policy.sh"

PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# Guard: script must exist before we can test it
# ---------------------------------------------------------------------------
if [ ! -x "$SCRIPT" ]; then
  echo "FAIL: $SCRIPT does not exist yet — expected to exist after fix"
  exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

LAST_STDERR_FILE=""

assert_exit() {
  local expected="$1"
  local actual="$2"
  local desc="$3"
  if [ "$actual" -eq "$expected" ]; then
    echo "PASS: $desc (exit $actual)"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc — expected exit $expected, got $actual"
    if [ -n "$LAST_STDERR_FILE" ] && [ -s "$LAST_STDERR_FILE" ]; then
      echo "--- stderr ---"
      cat "$LAST_STDERR_FILE"
      echo "--- end stderr ---"
    fi
    FAIL=$((FAIL + 1))
  fi
}

assert_exit_zero() {
  local actual="$1"
  local desc="$2"
  assert_exit 0 "$actual" "$desc"
}

assert_exit_nonzero() {
  local actual="$1"
  local desc="$2"
  if [ "$actual" -ne 0 ]; then
    echo "PASS: $desc (exit $actual, non-zero as expected)"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc — expected non-zero exit, got 0"
    if [ -n "$LAST_STDERR_FILE" ] && [ -s "$LAST_STDERR_FILE" ]; then
      echo "--- stderr ---"
      cat "$LAST_STDERR_FILE"
      echo "--- end stderr ---"
    fi
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------------------
# Shim builder
#
# Creates a temporary BIN directory with fake `curl` and `docker` executables.
# The curl shim reads call-count state from $SHIM_STATE_DIR and consults
# READY_SEQUENCE / VERIFY_SEQUENCE space-separated lists of exit codes.
#
# Usage:
#   setup_shims <tmpdir> <READY_SEQUENCE> <VERIFY_SEQUENCE>
#
# Returns (via echo): the path to the temp BIN dir.
# Call teardown_shims <tmpdir> when done.
# ---------------------------------------------------------------------------

setup_shims() {
  local tmpdir="$1"
  local ready_seq="$2"   # e.g. "7 7 0"  — exit codes for SELECT 1 calls
  local verify_seq="$3"  # e.g. "7 7 0"  — exit codes for storage_policies query

  local bin_dir="$tmpdir/bin"
  local state_dir="$tmpdir/state"
  mkdir -p "$bin_dir" "$state_dir"

  # Write sequences to state dir so the shim can read them
  printf '%s\n' $ready_seq  > "$state_dir/ready_seq"
  printf '%s\n' $verify_seq > "$state_dir/verify_seq"
  echo 0 > "$state_dir/ready_call"
  echo 0 > "$state_dir/verify_call"

  # ------------------------------------------------------------------
  # docker shim — always succeeds, prints a fake container ID for `run -d`
  # ------------------------------------------------------------------
  cat > "$bin_dir/docker" << 'DOCKERSHIM'
#!/usr/bin/env bash
# Fake docker: echo a container ID for `run -d`, exit 0 for everything else.
for arg in "$@"; do
  if [ "$arg" = "-d" ]; then
    echo "deadbeefdeadbeefdeadbeef"
    exit 0
  fi
done
exit 0
DOCKERSHIM
  chmod +x "$bin_dir/docker"

  # ------------------------------------------------------------------
  # curl shim
  # Distinguishes SELECT 1 (readiness) from storage_policies (verify).
  # Other calls (e.g. any future health-check variants) exit 0 silently.
  # ------------------------------------------------------------------
  cat > "$bin_dir/curl" << CURLSHIM
#!/usr/bin/env bash
# Fake curl shim.  Reads per-call sequences from STATE_DIR.
STATE_DIR="${state_dir}"

# Find the -d DATA argument to determine query type
DATA=""
while [ \$# -gt 0 ]; do
  if [ "\$1" = "-d" ]; then
    DATA="\$2"
    shift 2
  else
    shift
  fi
done

# Route by query content
if printf '%s' "\$DATA" | grep -qF "storage_policies"; then
  SEQ_FILE="\$STATE_DIR/verify_seq"
  CTR_FILE="\$STATE_DIR/verify_call"
else
  # Default: treat as readiness / SELECT 1
  SEQ_FILE="\$STATE_DIR/ready_seq"
  CTR_FILE="\$STATE_DIR/ready_call"
fi

# Read current call index
IDX=\$(cat "\$CTR_FILE")
NEXT_IDX=\$((IDX + 1))
echo "\$NEXT_IDX" > "\$CTR_FILE"

# Read the exit code at position IDX (0-based line number)
EXIT_CODE=\$(sed -n "\$((IDX + 1))p" "\$SEQ_FILE")

# If we've exhausted the sequence, repeat the last entry
if [ -z "\$EXIT_CODE" ]; then
  EXIT_CODE=\$(tail -1 "\$SEQ_FILE")
fi

# On success for a storage_policies query, print a plausible row
if [ "\$EXIT_CODE" -eq 0 ] && printf '%s' "\$DATA" | grep -qF "storage_policies"; then
  printf 'local_primary\thot\t['"'"'hot'"'"']\n'
fi

exit "\$EXIT_CODE"
CURLSHIM
  chmod +x "$bin_dir/curl"

  echo "$bin_dir"
}

teardown_shims() {
  local tmpdir="$1"
  rm -rf "$tmpdir"
}

# ---------------------------------------------------------------------------
# Test runner helper
# Prepends shim bin dir to PATH, exports required env vars, runs SCRIPT.
# ---------------------------------------------------------------------------

run_script() {
  local bin_dir="$1"
  local stderr_file
  stderr_file="$(mktemp)"
  LAST_STDERR_FILE="$stderr_file"
  PATH="$bin_dir:$PATH" \
    CLICKHOUSE_PASSWORD="ci_password" \
    bash "$SCRIPT" 2>"$stderr_file"
}

# ---------------------------------------------------------------------------
# Test a: KEY REGRESSION — readiness ready on attempt 3; verify flaps (exit 7
# twice) then succeeds on attempt 3.  With a single-shot verify the script
# would exit 7; with a retry loop it must exit 0.
# ---------------------------------------------------------------------------

run_test_a() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  # ready_seq: fail twice, succeed on third call
  # verify_seq: fail twice (exit 7), succeed on third call
  local bin_dir
  bin_dir="$(setup_shims "$tmpdir" "7 7 0" "7 7 0")"

  set +e
  run_script "$bin_dir"
  EXIT_CODE=$?
  set -e

  teardown_shims "$tmpdir"
  assert_exit_zero "$EXIT_CODE" \
    "test a: readiness ready on attempt 3, verify flaps then recovers → exit 0"
}

# ---------------------------------------------------------------------------
# Test b: BASELINE — readiness succeeds first try, verify succeeds first try.
# ---------------------------------------------------------------------------

run_test_b() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  local bin_dir
  bin_dir="$(setup_shims "$tmpdir" "0" "0")"

  set +e
  run_script "$bin_dir"
  EXIT_CODE=$?
  set -e

  teardown_shims "$tmpdir"
  assert_exit_zero "$EXIT_CODE" \
    "test b: readiness and verify both succeed first try → exit 0"
}

# ---------------------------------------------------------------------------
# Test c: Readiness never ready — 60+ consecutive curl failures.
# The loop gives up and the script must exit non-zero.
# ---------------------------------------------------------------------------

run_test_c() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  # Only code in sequence is 7; shim repeats last entry, so all calls exit 7
  local bin_dir
  bin_dir="$(setup_shims "$tmpdir" "7" "7")"

  set +e
  run_script "$bin_dir"
  EXIT_CODE=$?
  set -e

  teardown_shims "$tmpdir"
  assert_exit_nonzero "$EXIT_CODE" \
    "test c: readiness never ready → exit non-zero"
}

# ---------------------------------------------------------------------------
# Test d: Readiness ready, verify NEVER recovers — all verify attempts fail.
# Guards against an infinite or silent retry that swallows the error.
# ---------------------------------------------------------------------------

run_test_d() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  # ready succeeds on attempt 1; verify always exits 7
  local bin_dir
  bin_dir="$(setup_shims "$tmpdir" "0" "7")"

  set +e
  run_script "$bin_dir"
  EXIT_CODE=$?
  set -e

  teardown_shims "$tmpdir"
  assert_exit_nonzero "$EXIT_CODE" \
    "test d: readiness ready, verify never recovers → exit non-zero"
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------

run_test_a
run_test_b
run_test_c
run_test_d

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

exit 0

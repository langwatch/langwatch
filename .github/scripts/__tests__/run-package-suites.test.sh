#!/usr/bin/env bash
# Unit test for run-package-suites.sh
#
# Builds a throwaway workspace with a stub `pnpm` on PATH, so the gate's own
# logic — discovery, script choice, and the two registers — is exercised without
# running a single real vitest. The cases that matter are the ones where a
# mistake is silent: a failure nobody registered has to be loud, a register line
# for a package that no longer exists has to be loud, and an allowed failure
# that has started passing has to say so without turning the job red.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GATE_SOURCE="$SCRIPTS_DIR/run-package-suites.sh"

PASS=0
FAIL=0

report() {
  local ok="$1"
  local desc="$2"
  if [ "$ok" = "yes" ]; then
    echo "PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

FIXTURE="$(mktemp -d)"
cleanup() { rm -rf "$FIXTURE"; }
trap cleanup EXIT

mkdir -p "$FIXTURE/.github/scripts" "$FIXTURE/bin"
cp "$GATE_SOURCE" "$FIXTURE/.github/scripts/run-package-suites.sh"

# --- fixture workspace ------------------------------------------------------

make_package() {
  local dir="$1" name="$2" scripts="$3"
  mkdir -p "$FIXTURE/$dir"
  printf '{"name":"%s","version":"0.0.0","scripts":%s}\n' "$name" "$scripts" \
    > "$FIXTURE/$dir/package.json"
}

make_package "packages/green" "@fix/green" '{"test":"vitest run"}'
make_package "packages/red" "@fix/red" '{"test":"vitest run"}'
make_package "packages/known-red" "@fix/known-red" '{"test":"vitest run"}'
make_package "packages/elsewhere" "@fix/elsewhere" '{"test":"vitest run"}'
make_package "packages/no-suite" "@fix/no-suite" '{"build":"tsc"}'
# Both scripts present: the gate must choose test:unit, not test.
make_package "packages/both" "@fix/both" '{"test":"vitest run","test:unit":"vitest run --unit"}'
# A package with a second vitest lane. Its integration files are excluded from
# the first script, so the second is the only thing that runs them.
make_package "packages/two-lane" "@fix/two-lane" '{"test":"vitest run","test:integration":"vitest run --config vitest.integration.config.ts"}'
# A package whose ONLY suite is the integration lane. Discovery keyed solely on
# test/test:unit would drop it entirely.
make_package "packages/integration-only" "@fix/integration-only" '{"test:integration":"vitest run --config vitest.integration.config.ts"}'
# Covered elsewhere AND two-laned: the registers gate the package, not a script.
make_package "packages/elsewhere-two-lane" "@fix/elsewhere-two-lane" '{"test":"vitest run","test:integration":"vitest run --config vitest.integration.config.ts"}'

# --- stub pnpm --------------------------------------------------------------
#
# Answers the two calls the gate makes: the workspace listing, and one run per
# package. Every invocation is appended to $FIXTURE/invocations so the test can
# assert on what was and was not run.

cat > "$FIXTURE/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
FIXTURE="$(dirname "$(dirname "$0")")"
if [ "${1:-}" = "list" ]; then
  node -e '
    const fs = require("fs");
    const root = process.argv[1];
    const dirs = ["packages/green","packages/red","packages/known-red","packages/elsewhere","packages/no-suite","packages/both","packages/two-lane","packages/integration-only","packages/elsewhere-two-lane"];
    const out = [{ name: "@fix/workspace", version: "0.0.0", path: root, private: true }];
    for (const d of dirs) {
      const m = JSON.parse(fs.readFileSync(root + "/" + d + "/package.json", "utf8"));
      out.push({ name: m.name, version: m.version, path: root + "/" + d, private: true });
    }
    process.stdout.write(JSON.stringify(out));
  ' "$FIXTURE"
  exit 0
fi
# pnpm --filter <name> run <script>
NAME="$2"
SCRIPT="$4"
echo "$NAME $SCRIPT" >> "$FIXTURE/invocations"
# A line is either a package name (every script fails) or "<name> <script>"
# (only that lane fails) — the second form is what lets a test assert which
# script the gate blames.
grep -q "^$NAME\$" "$FIXTURE/failing" 2>/dev/null && exit 1
grep -q "^$NAME $SCRIPT\$" "$FIXTURE/failing" 2>/dev/null && exit 1
exit 0
STUB
chmod +x "$FIXTURE/bin/pnpm"

run_gate() {
  : > "$FIXTURE/invocations"
  PATH="$FIXTURE/bin:$PATH" bash "$FIXTURE/.github/scripts/run-package-suites.sh" 2>&1
}

# --- case 1: an unregistered failure fails the job --------------------------

printf '@fix/red\n@fix/known-red\n' > "$FIXTURE/failing"
printf '@fix/elsewhere  # runs in its own workflow\n' > "$FIXTURE/.github/package-suites.excluded"
printf '@fix/known-red  # broken since the move, tracked\n' > "$FIXTURE/.github/package-suites.allowed-failures"

OUT="$(run_gate)"
CODE=$?

if [ "$CODE" -ne 0 ]; then
  report yes "an unregistered failing suite fails the job"
else
  report no "expected a non-zero exit, got 0:
$OUT"
fi

if printf '%s' "$OUT" | grep -q "@fix/red failed"; then
  report yes "the failure names the package"
else
  report no "expected '@fix/red failed' in:
$OUT"
fi

if printf '%s' "$OUT" | grep -q "@fix/known-red failed, and is a registered allowed failure: broken since the move, tracked"; then
  report yes "a registered failure is reported with its reason, not as an error"
else
  report no "expected the registered failure and its reason in:
$OUT"
fi

if grep -q "^@fix/elsewhere " "$FIXTURE/invocations"; then
  report no "covered-elsewhere package was run anyway"
else
  report yes "a covered-elsewhere package is not run"
fi

if grep -q "^@fix/no-suite " "$FIXTURE/invocations"; then
  report no "a package with no test script was run"
else
  report yes "a package with no test script is not discovered"
fi

if grep -q "^@fix/both test:unit\$" "$FIXTURE/invocations"; then
  report yes "test:unit wins over test where a package has both"
else
  report no "expected '@fix/both test:unit' in invocations:
$(cat "$FIXTURE/invocations")"
fi

# --- case 2: every failure registered, the job is green ---------------------

printf '@fix/known-red\n' > "$FIXTURE/failing"
OUT="$(run_gate)"
CODE=$?

if [ "$CODE" -eq 0 ]; then
  report yes "with every failure registered the job is green"
else
  report no "expected exit 0, got $CODE:
$OUT"
fi

# --- case 3: a registered failure that now passes -------------------------—

: > "$FIXTURE/failing"
OUT="$(run_gate)"
CODE=$?

if [ "$CODE" -eq 0 ]; then
  report yes "a registered failure that now passes keeps the job green"
else
  report no "expected exit 0, got $CODE:
$OUT"
fi

if printf '%s' "$OUT" | grep -q "Delete its line"; then
  report yes "a registered failure that now passes is announced for removal"
else
  report no "expected the removal warning in:
$OUT"
fi

# --- case 4: a register entry naming no real package ------------------------

printf '@fix/known-red  # broken since the move, tracked\n@fix/ghost  # renamed away three months ago\n' \
  > "$FIXTURE/.github/package-suites.allowed-failures"
OUT="$(run_gate)"
CODE=$?

if [ "$CODE" -ne 0 ] && printf '%s' "$OUT" | grep -q "@fix/ghost' is registered but no workspace package"; then
  report yes "a register entry for a package that does not exist fails the job"
else
  report no "expected a stale-entry failure, got exit $CODE:
$OUT"
fi

# --- case 5: a register entry with no reason --------------------------------

printf '@fix/known-red\n' > "$FIXTURE/.github/package-suites.allowed-failures"
OUT="$(run_gate)"
CODE=$?

if [ "$CODE" -ne 0 ] && printf '%s' "$OUT" | grep -q "has no reason"; then
  report yes "a register entry without a reason fails the job"
else
  report no "expected a missing-reason failure, got exit $CODE:
$OUT"
fi

# --- case 6: the same package in both registers -----------------------------

printf '@fix/known-red  # broken since the move, tracked\n@fix/elsewhere  # also here by mistake\n' \
  > "$FIXTURE/.github/package-suites.allowed-failures"
OUT="$(run_gate)"
CODE=$?

if [ "$CODE" -ne 0 ] && printf '%s' "$OUT" | grep -q "is in both registers"; then
  report yes "a package in both registers fails the job"
else
  report no "expected a both-registers failure, got exit $CODE:
$OUT"
fi

# --- the integration lane -----------------------------------------------—
#
# A package may split its tests across two vitest configs, excluding the
# integration files from the first script and naming a second. Discovery used to
# ask only for test/test:unit, so the exclusion took effect and the lane never
# did — @langwatch/trace-server's four integration suites ran in no job at all
# and nothing went red, because a suite CI never starts cannot fail.
#
# See specs/ci/package-suite-integration-lane.feature.

reset_registers() {
  printf '@fix/elsewhere  # runs in its own workflow\n@fix/elsewhere-two-lane  # runs in its own workflow\n' \
    > "$FIXTURE/.github/package-suites.excluded"
  printf '@fix/known-red  # broken since the move, tracked\n' \
    > "$FIXTURE/.github/package-suites.allowed-failures"
}

assert_ran() {
  local line="$1" desc="$2"
  if grep -q "^$line\$" "$FIXTURE/invocations"; then
    report yes "$desc"
  else
    report no "$desc — no '$line' in:
$(cat "$FIXTURE/invocations")"
  fi
}

assert_did_not_run() {
  local line="$1" desc="$2"
  if grep -q "^$line\$" "$FIXTURE/invocations"; then
    report no "$desc — '$line' was run anyway"
  else
    report yes "$desc"
  fi
}

# @scenario "A package that declares an integration suite has it run"
test_a_declared_integration_suite_is_run() {
  reset_registers
  printf '@fix/known-red\n' > "$FIXTURE/failing"

  run_gate > /dev/null

  assert_ran "@fix/two-lane test" \
    "a two-lane package still runs its unit script"
  assert_ran "@fix/two-lane test:integration" \
    "a two-lane package also runs its integration script"
}

# @scenario "A package whose only suite is an integration suite is still discovered"
test_an_integration_only_package_is_discovered() {
  reset_registers
  printf '@fix/known-red\n' > "$FIXTURE/failing"

  run_gate > /dev/null

  assert_ran "@fix/integration-only test:integration" \
    "a package whose only suite is the integration lane is discovered and run"
}

# @scenario "A failing integration suite fails the package and names the script"
test_a_failing_integration_suite_names_its_own_script() {
  reset_registers
  printf '@fix/known-red\n@fix/two-lane test:integration\n' > "$FIXTURE/failing"

  local out code
  out="$(run_gate)"
  code=$?

  if [ "$code" -ne 0 ]; then
    report yes "a failing integration lane fails the job"
  else
    report no "expected a non-zero exit, got 0:
$out"
  fi

  if printf '%s' "$out" | grep -q "@fix/two-lane failed (pnpm run test:integration"; then
    report yes "the failure names the integration script, not the unit one"
  else
    report no "expected the integration script to be blamed in:
$out"
  fi

  assert_ran "@fix/two-lane test" \
    "the unit script ran even though the integration lane failed"
}

# @scenario "An excluded package runs neither of its suites"
test_an_excluded_package_runs_neither_lane() {
  reset_registers
  printf '@fix/known-red\n' > "$FIXTURE/failing"

  run_gate > /dev/null

  assert_did_not_run "@fix/elsewhere-two-lane test" \
    "an excluded package does not run its unit script"
  assert_did_not_run "@fix/elsewhere-two-lane test:integration" \
    "an excluded package does not run its integration script either"
}

test_a_declared_integration_suite_is_run
test_an_integration_only_package_is_discovered
test_a_failing_integration_suite_names_its_own_script
test_an_excluded_package_runs_neither_lane

echo ""
echo "run-package-suites.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

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
    const dirs = ["packages/green","packages/red","packages/known-red","packages/elsewhere","packages/no-suite","packages/both"];
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
grep -q "^$NAME\$" "$FIXTURE/failing" 2>/dev/null && exit 1
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

echo ""
echo "run-package-suites.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

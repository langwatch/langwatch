#!/usr/bin/env bash
# Unit test for notify-slack-release.sh
# Asserts that the changelog is split into section blocks Slack accepts, that
# a missing version sends no empty block, and that a rejected webhook call
# fails the step.
#
# The webhook call is replaced by a `curl` stub placed first on PATH. It
# records the payload and prints whatever body the test asks for, so the test
# needs no network and no Slack workspace.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NOTIFY="$SCRIPTS_DIR/notify-slack-release.sh"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

PAYLOAD_FILE="$WORK_DIR/payload.json"
STUB_DIR="$WORK_DIR/bin"
mkdir -p "$STUB_DIR"

cat > "$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
# Records the --data argument and prints the body the test asked for.
while [ $# -gt 0 ]; do
  if [ "$1" = "--data" ]; then
    printf '%s' "$2" > "$LW_TEST_PAYLOAD_FILE"
    shift 2
    continue
  fi
  shift
done
printf '%s' "${LW_TEST_WEBHOOK_BODY:-ok}"
STUB
chmod +x "$STUB_DIR/curl"

export LW_TEST_PAYLOAD_FILE="$PAYLOAD_FILE"
export PATH="$STUB_DIR:$PATH"
export SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL="https://hooks.slack.test/services/fake"

PASS=0
FAIL=0

pass() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL=$((FAIL + 1))
}

assert_eq() {
  local actual="$1" expected="$2" desc="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$desc"
  else
    fail "$desc — expected '$expected', got '$actual'"
  fi
}

# Runs the script against a changelog fixture. Sets RUN_EXIT.
run_notify() {
  local changelog="$1" version="$2"
  rm -f "$PAYLOAD_FILE"
  set +e
  bash "$NOTIFY" "$changelog" "Test Component" "$version" > "$WORK_DIR/stdout.txt" 2>&1
  RUN_EXIT=$?
  set -e
}

section_texts() {
  jq -r '[.blocks[] | select(.type == "section") | .text.text]' "$PAYLOAD_FILE"
}

# ---------------------------------------------------------------------------
# A changelog far past the 3000-character section cap.
# ---------------------------------------------------------------------------
BIG_CHANGELOG="$WORK_DIR/big-changelog.md"
{
  echo "## [9.9.9](https://github.com/langwatch/langwatch/compare/v9.9.8...v9.9.9) (2026-08-18)"
  echo ""
  echo "### Features"
  echo ""
  for i in $(seq 1 200); do
    echo "* feature number $i with a reasonably long commit subject line to pad the changelog ([#$i](https://github.com/langwatch/langwatch/issues/$i))"
  done
  echo ""
  echo "## [9.9.8](https://github.com/langwatch/langwatch/compare/v9.9.7...v9.9.8) (2026-08-17)"
  echo ""
  echo "* an entry from an older version that must not be included"
} > "$BIG_CHANGELOG"

run_notify "$BIG_CHANGELOG" "9.9.9"
assert_eq "$RUN_EXIT" "0" "oversized changelog exits 0"

OVER_CAP=$(section_texts | jq '[.[] | select(length > 3000)] | length')
assert_eq "$OVER_CAP" "0" "no section block goes past the 3000 character cap"

EMPTY_SECTIONS=$(section_texts | jq '[.[] | select(length == 0)] | length')
assert_eq "$EMPTY_SECTIONS" "0" "no section block is empty"

if jq -e '[.blocks[] | select(.type == "section") | .text.text]
          | any(contains("Changelog truncated"))' "$PAYLOAD_FILE" > /dev/null; then
  pass "an oversized changelog gets the truncation notice"
else
  fail "an oversized changelog should get the truncation notice"
fi

if grep -qF "older version that must not be included" "$PAYLOAD_FILE"; then
  fail "the previous version's entries leaked into the message"
else
  pass "only the requested version's entries are sent"
fi

# ---------------------------------------------------------------------------
# A single line longer than the cap. Line boundaries cannot split this one,
# so the chunker has to cut the line itself.
# ---------------------------------------------------------------------------
LONG_LINE_CHANGELOG="$WORK_DIR/long-line-changelog.md"
# Only this line carries the letter Z, so a count over the sent blocks tells
# a split apart from a truncation.
LONG_SUBJECT=$(head -c 7000 < /dev/zero | tr '\0' 'Z')
{
  echo "## [1.2.3](https://github.com/langwatch/langwatch/compare/v1.2.2...v1.2.3) (2026-08-18)"
  echo ""
  echo "### Bug Fixes"
  echo ""
  echo "* $LONG_SUBJECT"
} > "$LONG_LINE_CHANGELOG"

run_notify "$LONG_LINE_CHANGELOG" "1.2.3"
assert_eq "$RUN_EXIT" "0" "single oversized line exits 0"

OVER_CAP=$(section_texts | jq '[.[] | select(length > 3000)] | length')
assert_eq "$OVER_CAP" "0" "a single line past the cap is cut into blocks under the cap"

# The blocks joined back together must still hold the whole line. Without
# this, an implementation that drops the remainder passes the cap check.
SENT_JOINED=$(section_texts | jq -r 'join("")' | tr -d '\n')
SENT_Z_COUNT=$(printf '%s' "$SENT_JOINED" | tr -cd 'Z' | wc -c | tr -d ' ')
assert_eq "$SENT_Z_COUNT" "7000" "the oversized line is split, not truncated"

case "$SENT_JOINED" in
  *"$LONG_SUBJECT"*) pass "the oversized line survives the split unbroken" ;;
  *) fail "the oversized line should survive the split unbroken" ;;
esac

# ---------------------------------------------------------------------------
# A small changelog stays in one section block.
# ---------------------------------------------------------------------------
SMALL_CHANGELOG="$WORK_DIR/small-changelog.md"
{
  echo "## [1.0.1](https://github.com/langwatch/langwatch/compare/v1.0.0...v1.0.1) (2026-08-18)"
  echo ""
  echo "### Bug Fixes"
  echo ""
  echo "* fixed the thing ([#42](https://github.com/langwatch/langwatch/issues/42))"
} > "$SMALL_CHANGELOG"

run_notify "$SMALL_CHANGELOG" "1.0.1"
assert_eq "$RUN_EXIT" "0" "small changelog exits 0"

CHANGELOG_SECTIONS=$(section_texts | jq '[.[] | select(startswith("*Test Component") | not)] | length')
assert_eq "$CHANGELOG_SECTIONS" "1" "a small changelog stays in one section block"

if jq -e '[.blocks[] | select(.type == "section") | .text.text]
          | any(contains("🐛 Bug Fixes"))' "$PAYLOAD_FILE" > /dev/null; then
  pass "section headings keep their emoji"
else
  fail "section headings should keep their emoji"
fi

# ---------------------------------------------------------------------------
# A version with no changelog entry sends no empty block.
# ---------------------------------------------------------------------------
run_notify "$SMALL_CHANGELOG" "7.7.7"
assert_eq "$RUN_EXIT" "0" "missing version exits 0"

CHANGELOG_SECTIONS=$(section_texts | jq '[.[] | select(startswith("*Test Component") | not)] | length')
assert_eq "$CHANGELOG_SECTIONS" "0" "a missing version sends no changelog block"

EMPTY_SECTIONS=$(section_texts | jq '[.[] | select(length == 0)] | length')
assert_eq "$EMPTY_SECTIONS" "0" "a missing version sends no empty block"

# ---------------------------------------------------------------------------
# A webhook body other than "ok" fails the step.
# ---------------------------------------------------------------------------
LW_TEST_WEBHOOK_BODY="invalid_blocks" run_notify "$SMALL_CHANGELOG" "1.0.1"
assert_eq "$RUN_EXIT" "1" "a rejected webhook call exits 1"

if grep -qF "invalid_blocks" "$WORK_DIR/stdout.txt"; then
  pass "the rejection body is printed"
else
  fail "the rejection body should be printed"
fi

# ---------------------------------------------------------------------------
# No webhook URL means no notification and no failure.
# ---------------------------------------------------------------------------
rm -f "$PAYLOAD_FILE"
set +e
SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL="" bash "$NOTIFY" "$SMALL_CHANGELOG" "Test Component" "1.0.1" > /dev/null 2>&1
RUN_EXIT=$?
set -e
assert_eq "$RUN_EXIT" "0" "no webhook URL exits 0"

if [ -f "$PAYLOAD_FILE" ]; then
  fail "no webhook URL should send nothing"
else
  pass "no webhook URL sends nothing"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

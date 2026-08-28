#!/usr/bin/env bash
set -uo pipefail

# Checks that check-docs-prose.sh reports a banned word, and that a docs line
# holding a carriage return or a percent sign cannot reach the ::error
# annotation unencoded. GitHub reads an ::error line as a workflow command, so
# an unencoded carriage return would end the annotation early and an unencoded
# percent sign would read as an encoded character.
#
# The script scans the docs tree it sits in, so the test copies it into a
# temporary tree that holds one page. The real docs are untouched.

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/docs/scripts"
cp "$SCRIPTS_DIR/check-docs-prose.sh" "$WORK/docs/scripts/check-docs-prose.sh"

# A banned word, a percent sign and a carriage return, on one line.
printf 'Nothing 100%% here\r and more\n' > "$WORK/docs/page.mdx"

OUTPUT="$(bash "$WORK/docs/scripts/check-docs-prose.sh" --all 2>&1)"
STATUS=$?

FAILURES=0

check() {
  local description="$1"
  local ok="$2"
  if [[ "$ok" == "yes" ]]; then
    echo "ok: $description"
  else
    echo "FAILED: $description"
    FAILURES=$((FAILURES + 1))
  fi
}

if [[ $STATUS -eq 1 ]]; then
  check "the banned word fails the check" yes
else
  check "the banned word fails the check" no
fi

ANNOTATION="$(printf '%s\n' "$OUTPUT" | grep '^::error' | head -1)"

if [[ "$ANNOTATION" == *"page.mdx"* ]]; then
  check "the annotation names the page" yes
else
  check "the annotation names the page" no
fi

if [[ "$ANNOTATION" == *$'\r'* ]]; then
  check "the carriage return stays out of the annotation" no
else
  check "the carriage return stays out of the annotation" yes
fi

if [[ "$ANNOTATION" == *"%0D"* ]]; then
  check "the carriage return reads as %0D" yes
else
  check "the carriage return reads as %0D" no
fi

if [[ "$ANNOTATION" == *"100%25"* ]]; then
  check "the percent sign reads as %25" yes
else
  check "the percent sign reads as %25" no
fi

if [[ $FAILURES -gt 0 ]]; then
  echo ""
  echo "Annotation: $ANNOTATION"
  echo "$FAILURES check(s) failed."
  exit 1
fi

echo "check-docs-prose.sh annotation checks passed."

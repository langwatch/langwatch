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

# A banned word, a percent sign and a carriage return, on one line. The page
# name carries a colon and a comma, which is what separates the annotation
# properties from each other and from the message.
PAGE_NAME='page,one:two.mdx'
printf 'Nothing 100%% here\r and more\n' > "$WORK/docs/$PAGE_NAME"

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

if [[ "$ANNOTATION" == *"page%2Cone%3Atwo.mdx"* ]]; then
  check "the page name reads with its colon and comma encoded" yes
else
  check "the page name reads with its colon and comma encoded" no
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

# A paragraph over the word limit fails, a list item over it fails, and a
# table row or a paragraph split in two passes. An indented heading, a table
# written without its outer pipes and a list item of exactly the limit pass
# too. The limit is set low so the page stays short.
LONG_PAGE="$WORK/docs/long.mdx"
{
  printf -- '---\ntitle: Long\n---\n\n'
  printf 'one two three four five six seven eight nine ten eleven twelve\n\n'
  printf -- '- one two three four five six seven eight nine ten eleven twelve\n- one two three\n\n'
  printf '| one two three four five six seven eight nine ten eleven twelve |\n\n'
  printf '   ### one two three four five six seven eight nine ten eleven twelve\n\n'
  printf 'one two three four five six | seven eight nine ten eleven twelve\n'
  printf -- '--- | ---\n'
  printf 'one two three four five six | seven eight nine ten eleven twelve\n\n'
  printf -- '- one two three four five six seven eight nine ten\n\n'
  printf -- '````markdown\n```bash\necho one two three four five six seven eight nine ten eleven\n```\n````\n\n'
  printf 'one two three four five six\n\none two three four five six\n'
} > "$LONG_PAGE"
rm -f "$WORK/docs/$PAGE_NAME"

LONG_OUTPUT="$(DOCS_PROSE_MAX_PARAGRAPH_WORDS=10 bash "$WORK/docs/scripts/check-docs-prose.sh" --all 2>&1)"
LONG_COUNT="$(printf '%s\n' "$LONG_OUTPUT" | grep -c 'words, the limit is 10' || true)"

if [[ "$LONG_COUNT" -eq 2 ]]; then
  check "the long paragraph and the long list item fail, the table row and the split paragraphs pass" yes
else
  check "the long paragraph and the long list item fail, the table row and the split paragraphs pass" no
  echo "Output: $LONG_OUTPUT"
fi

if printf '%s\n' "$LONG_OUTPUT" | grep -q 'long.mdx,line=12::'; then
  check "the indented heading is not counted as prose" no
  echo "Output: $LONG_OUTPUT"
else
  check "the indented heading is not counted as prose" yes
fi

if printf '%s\n' "$LONG_OUTPUT" | grep -qE 'long.mdx,line=1[456]::'; then
  check "a table without outer pipes is not counted as prose" no
  echo "Output: $LONG_OUTPUT"
else
  check "a table without outer pipes is not counted as prose" yes
fi

if printf '%s\n' "$LONG_OUTPUT" | grep -q 'long.mdx,line=18::'; then
  check "a list item of exactly the limit passes" no
  echo "Output: $LONG_OUTPUT"
else
  check "a list item of exactly the limit passes" yes
fi

# The nested fence block sits at lines 20-24 and the prose after it at 26 and
# 28. A fence rule that toggles on every fence line leaves the scanner inside
# a code block from line 24 on, so the paragraphs after it stop being read.
if printf '%s\n' "$LONG_OUTPUT" | grep -qE 'long.mdx,line=2[0-4]::'; then
  check "a fence nested in a longer fence stays code" no
  echo "Output: $LONG_OUTPUT"
else
  check "a fence nested in a longer fence stays code" yes
fi

TAIL_OUTPUT="$(DOCS_PROSE_MAX_PARAGRAPH_WORDS=5 bash "$WORK/docs/scripts/check-docs-prose.sh" --all 2>&1)"
if printf '%s\n' "$TAIL_OUTPUT" | grep -q 'long.mdx,line=26::'; then
  check "prose after a nested fence block is still read" yes
else
  check "prose after a nested fence block is still read" no
  echo "Output: $TAIL_OUTPUT"
fi

if printf '%s\n' "$LONG_OUTPUT" | grep -q 'long.mdx,line=5::'; then
  check "the annotation points at the first line of the long paragraph" yes
else
  check "the annotation points at the first line of the long paragraph" no
fi

if [[ $FAILURES -gt 0 ]]; then
  echo ""
  echo "Annotation: $ANNOTATION"
  echo "$FAILURES check(s) failed."
  exit 1
fi

echo "check-docs-prose.sh annotation checks passed."

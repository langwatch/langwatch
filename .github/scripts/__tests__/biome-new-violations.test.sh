#!/usr/bin/env bash
# Unit test for biome-new-violations.sh
#
# Builds a throwaway git repository that moves one file between the merge base
# and HEAD, then drives the gate with a stub biome. It proves the two cases a
# rename-aware gate must separate:
#
#   1. A moved file with unchanged counts reports nothing.
#   2. A moved file whose count grew still fails, naming the new path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GATE="$SCRIPTS_DIR/biome-new-violations.sh"

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

RULE="lint/complexity/noExcessiveLinesPerFunction"

# rdjson carrying `count` diagnostics for one path.
write_rdjson() {
  local out="$1"
  local path="$2"
  local count="$3"
  {
    printf '{"source":{"name":"biome"},"diagnostics":['
    local i
    for ((i = 0; i < count; i++)); do
      [ "$i" -gt 0 ] && printf ','
      printf '{"message":"too many lines","code":{"value":"%s"},' "$RULE"
      printf '"location":{"path":"%s","range":{"start":{"line":%d,"column":1}}}}' \
        "$path" "$((i + 1))"
    done
    printf ']}'
  } > "$out"
}

REPO="$(mktemp -d)"
cleanup() {
  git -C "$REPO" worktree prune >/dev/null 2>&1 || true
  rm -rf "$REPO"
}
trap cleanup EXIT

# --- fixture repository -----------------------------------------------------
mkdir -p "$REPO/platform/app/src" "$REPO/platform/app/node_modules/.bin"
cd "$REPO"
git init --quiet -b main
git config user.email "ci@example.com"
git config user.name "CI"

echo '{"name":"@langwatch/web"}' > platform/app/package.json
echo '{}' > platform/app/biome.jsonc
echo 'export const value = 1;' > platform/app/src/old-name.tsx

# The stub stands in for biome in the base tree: the gate lints the base
# itself, and takes the head report as an argument.
BASE_REPORT="$REPO/base.rdjson"
write_rdjson "$BASE_REPORT" "src/old-name.tsx" 2
cat > platform/app/node_modules/.bin/biome <<STUB
#!/usr/bin/env bash
for arg in "\$@"; do
  if [ "\$arg" = "--reporter=rdjson" ]; then
    cat "$BASE_REPORT"
    exit 1
  fi
done
exit 0
STUB
chmod +x platform/app/node_modules/.bin/biome

git add -A
git commit --quiet -m "base"
BASE_REF="$(git rev-parse HEAD)"

git mv platform/app/src/old-name.tsx platform/app/src/new-name.tsx
git commit --quiet -am "move the page to its new address"

# --- case 1: the move alone reports nothing ---------------------------------
HEAD_SAME="$REPO/head-same.rdjson"
write_rdjson "$HEAD_SAME" "src/new-name.tsx" 2

set +e
OUT_SAME="$(bash "$GATE" "$HEAD_SAME" "$BASE_REF" ./src 2>&1)"
EXIT_SAME=$?
set -e

if [ "$EXIT_SAME" -eq 0 ]; then
  report yes "a moved file with unchanged counts exits 0"
else
  report no "a moved file with unchanged counts exits 0, got $EXIT_SAME:
$OUT_SAME"
fi

if printf '%s' "$OUT_SAME" | grep -q "no new Biome violations"; then
  report yes "a moved file with unchanged counts reports no new violations"
else
  report no "expected 'no new Biome violations' in:
$OUT_SAME"
fi

# --- case 2: the move plus a grown count still fails ------------------------
HEAD_GROWN="$REPO/head-grown.rdjson"
write_rdjson "$HEAD_GROWN" "src/new-name.tsx" 3

set +e
OUT_GROWN="$(bash "$GATE" "$HEAD_GROWN" "$BASE_REF" ./src 2>&1)"
EXIT_GROWN=$?
set -e

if [ "$EXIT_GROWN" -eq 1 ]; then
  report yes "a moved file with a grown count exits 1"
else
  report no "a moved file with a grown count exits 1, got $EXIT_GROWN:
$OUT_GROWN"
fi

if printf '%s' "$OUT_GROWN" | grep -q "This PR adds 1 Biome violation"; then
  report yes "a moved file with a grown count counts one new violation"
else
  report no "expected 'This PR adds 1 Biome violation' in:
$OUT_GROWN"
fi

if printf '%s' "$OUT_GROWN" | grep -q "src/new-name.tsx"; then
  report yes "the failure names the new path"
else
  report no "expected 'src/new-name.tsx' in:
$OUT_GROWN"
fi

if printf '%s' "$OUT_GROWN" | grep -q "$RULE: 2 -> 3"; then
  report yes "the failure counts from the old path's base total"
else
  report no "expected '$RULE: 2 -> 3' in:
$OUT_GROWN"
fi

echo ""
echo "biome-new-violations.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

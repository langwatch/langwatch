#!/usr/bin/env bash
# Unit test for release-docs.sh against a local origin whose main moves, and
# whose pre-receive hook refuses pushes to stand in for losing the race.
#
# Spec: specs/ci/docs-release.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../release-docs.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $label"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

g() {
  git -c user.name=t -c user.email=t@example.com -c init.defaultBranch=main \
    -c commit.gpgsign=false "$@"
}

# An origin holding docs/docs.json, and a runner clone of it at that commit.
setup() {
  local case="$WORK/$1" seed="$WORK/$1/seed"
  mkdir -p "$seed/docs"
  g init -q "$seed"
  echo '{"redirects":[{"source":"/ci/cache/busted/1","destination":"/"}]}' >"$seed/docs/docs.json"
  g -C "$seed" add -A
  g -C "$seed" commit -q -m seed
  g clone -q --bare "$seed" "$case/origin.git"
  g clone -q "$case/origin.git" "$case/runner"
}

# Refuses the first <n> pushes to main, then accepts.
refuse_pushes() {
  local origin="$1" n="$2"
  echo 0 >"$origin/refused"
  cat >"$origin/hooks/pre-receive" <<EOF
#!/usr/bin/env bash
count=\$(cat "$origin/refused")
if [ "\$count" -lt $n ]; then echo \$((count + 1)) >"$origin/refused"; exit 1; fi
EOF
  chmod +x "$origin/hooks/pre-receive"
}

release() {
  (cd "$1" && git config user.name t && git config user.email t@example.com \
    && RELEASE_DOCS_RETRY_SECONDS=0 RELEASE_DOCS_ATTEMPTS=3 bash "$SCRIPT" "test")
}

busted_source() {
  g -C "$1" show main:docs/docs.json | jq -r '.redirects[0].source'
}

# @scenario "The docs release rewrites the redirect on the newest main"
test_rewrites_on_the_newest_main() {
  setup newest
  local case="$WORK/newest" other="$WORK/newest/other"
  g clone -q "$case/origin.git" "$other"
  echo merged >"$other/merged.txt"
  g -C "$other" add -A
  g -C "$other" commit -q -m "a merge that lands meanwhile"
  g -C "$other" push -q origin HEAD:main

  local status=0
  release "$case/runner" >/dev/null 2>&1 || status=$?
  check "pushes over a main that moved" 0 "$status"
  check "keeps the merge that landed meanwhile" "merged" "$(g -C "$case/origin.git" show main:merged.txt)"
  check "rewrites the redirect" "no" "$([ "$(busted_source "$case/origin.git")" = "/ci/cache/busted/1" ] && echo yes || echo no)"
}

# @scenario "The docs release retries a push that lost the race"
test_retries_a_refused_push() {
  setup retry
  local case="$WORK/retry"
  refuse_pushes "$case/origin.git" 1
  local status=0 output
  output=$(release "$case/runner" 2>&1) || status=$?
  check "succeeds on a later attempt" 0 "$status"
  check "says which attempt pushed" "Docs released on attempt 2." "$(echo "$output" | grep -o 'Docs released on attempt [0-9]*\.')"
}

# @scenario "The docs release fails once every attempt lost the race"
test_fails_when_every_attempt_is_refused() {
  setup exhausted
  local case="$WORK/exhausted"
  refuse_pushes "$case/origin.git" 99
  local status=0 output
  output=$(release "$case/runner" 2>&1) || status=$?
  check "exits non-zero" 1 "$status"
  check "names the failure" "1" "$(echo "$output" | grep -c 'not pushed after 3 attempts')"
  check "leaves main as it was" "/ci/cache/busted/1" "$(busted_source "$case/origin.git")"
}

test_rewrites_on_the_newest_main
test_retries_a_refused_push
test_fails_when_every_attempt_is_refused

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

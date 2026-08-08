#!/usr/bin/env bash
# Tests for secrets-scan.sh — the scoping of the blocking secrets gate.
#
# Every case builds a THROWAWAY repository pair and runs the real scanners
# against it. The fixture reproduces the ref layout `actions/checkout` actually
# leaves behind on a pull request with `fetch-depth: 0`, because that layout is
# the whole bug: every branch of the repository is present as a
# remote-tracking ref, and HEAD is detached with refs/heads/* empty. Asserting
# on the command string instead would pass just as happily with `--branch`
# spelled wrong.
#
# Requires `git`, `gitleaks` and `trufflehog` on PATH. It does NOT skip when
# they are missing: a secrets test that quietly reports success because the
# scanner was absent is the same false green the gate exists to prevent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN="$SCRIPT_DIR/../secrets-scan.sh"

PASS=0
FAIL=0

# A syntactically valid AWS key pair. It is not a live credential — no such
# account exists — which is exactly why the scans below run in offline mode.
readonly PLANTED_SECRET='AWS_ACCESS_KEY_ID=AKIAQYLPMN5HHHFPZAM2
AWS_SECRET_ACCESS_KEY=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'

# Two shell function names, and nothing else. Both are `test_` plus exactly 35
# characters of [A-Za-z0-9_], which is the shape TruffleHog's Lob detector
# matches — and its verifier accepts them, so they arrive as VERIFIED findings
# that --only-verified cannot filter. Both are real names lifted from
# charts/langwatch/tests, where they blocked pull requests that had not touched
# them. A gate that fails on a function name teaches everyone to ignore it.
readonly PLANTED_SHELL_FUNCTIONS='#!/usr/bin/env bash
test_scaling_one_deployment_resizes_both() { :; }
test_unconfigured_providers_emit_nothing() { :; }'

WORKSPACE="$(mktemp -d)"
trap 'rm -rf "$WORKSPACE"' EXIT

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "FATAL: $1 is not on PATH. These tests run the real scanners." >&2
    exit 2
  fi
}

commit_at() {
  local repo="$1" date="$2" message="$3"
  git -C "$repo" add -A
  GIT_AUTHOR_DATE="$date" GIT_COMMITTER_DATE="$date" \
    git -C "$repo" commit -qm "$message"
}

# Builds an origin repository plus the working checkout CI would produce for a
# pull request against `main`. `$1` names the fixture (and its directory);
# `$2` says where the planted secret goes. Echoes the working checkout's path.
build_checkout() {
  local name="$1" secret_at="$2"
  local root="$WORKSPACE/$name"
  local origin="$root/origin" work="$root/work"
  mkdir -p "$root"

  git init -q -b main "$origin"
  git -C "$origin" config user.email ci@example.test
  git -C "$origin" config user.name "CI Fixture"
  echo "hello" >"$origin/README.md"
  [ "$secret_at" = "base" ] && printf '%s\n' "$PLANTED_SECRET" >"$origin/base-leak.env"
  commit_at "$origin" "2026-08-01T00:00:00Z" "base"

  # An unrelated branch, pushed after the merge base. Its commit is NEWER than
  # the base, which is what puts it ahead of the base in `git log --all`'s
  # date order and therefore inside an unscoped walk.
  git -C "$origin" checkout -q -b unrelated
  printf '%s\n' "$PLANTED_SECRET" >"$origin/unrelated-leak.env"
  if [ "$secret_at" = "other-branch" ]; then
    commit_at "$origin" "2026-08-05T00:00:00Z" "unrelated branch adds a secret"
  else
    rm -f "$origin/unrelated-leak.env"
    echo "unrelated work" >"$origin/unrelated.md"
    commit_at "$origin" "2026-08-05T00:00:00Z" "unrelated branch"
  fi

  git -C "$origin" checkout -q main
  git -C "$origin" checkout -q -b pr
  echo "a harmless line" >>"$origin/README.md"
  case "$secret_at" in
    pr | pr-then-deleted)
      printf '%s\n' "$PLANTED_SECRET" >"$origin/pr-leak.env"
      ;;
    pr-shell-functions)
      printf '%s\n' "$PLANTED_SHELL_FUNCTIONS" >"$origin/pr-chart-test.sh"
      ;;
  esac
  commit_at "$origin" "2026-08-06T00:00:00Z" "pull request commit"
  if [ "$secret_at" = "pr-then-deleted" ]; then
    rm -f "$origin/pr-leak.env"
    commit_at "$origin" "2026-08-06T01:00:00Z" "remove the file again"
  fi
  local head_sha
  head_sha="$(git -C "$origin" rev-parse HEAD)"
  git -C "$origin" checkout -q main

  # actions/checkout@v6, fetch-depth: 0, pull_request event — the refspec and
  # the detached checkout are copied from a real run's log.
  git init -q "$work"
  git -C "$work" config user.email ci@example.test
  git -C "$work" config user.name "CI Fixture"
  git -C "$work" remote add origin "$origin"
  git -C "$work" fetch -q --no-tags --prune --no-recurse-submodules origin \
    "+refs/heads/*:refs/remotes/origin/*" \
    "+${head_sha}:refs/remotes/pull/1/merge"
  git -C "$work" checkout -q --force refs/remotes/pull/1/merge

  echo "$work"
}

# Runs the gate the way the workflow does. Echoes nothing; returns the exit
# code and leaves the combined output in $LAST_OUTPUT.
#
# $SCAN_MODE selects TruffleHog's mode. `offline` is the default and what the
# scoping cases need, since a planted secret has to be reportable without being
# real. Set it empty to run the gate exactly as CI does, verification included
# — the only way to observe a detector whose matches appear solely as verified
# results.
LAST_OUTPUT=""
SCAN_MODE="offline"
run_scan() {
  local scanner="$1" work="$2"
  local rc=0
  set +e
  LAST_OUTPUT="$(
    EVENT_NAME=pull_request \
      BASE_REF=main \
      SECRETS_SCAN_TRUFFLEHOG_MODE="$SCAN_MODE" \
      bash "$SCAN" "$scanner" "$work" 2>&1
  )"
  rc=$?
  set -e
  return $rc
}

record() {
  local ok="$1" description="$2"
  if [ "$ok" = "yes" ]; then
    echo "PASS: $description"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $description"
    echo "----- scan output -----"
    echo "$LAST_OUTPUT"
    echo "-----------------------"
    FAIL=$((FAIL + 1))
  fi
}

assert_scan_passes() {
  local scanner="$1" work="$2" description="$3"
  if run_scan "$scanner" "$work"; then
    record yes "$description"
  else
    record no "$description (exit $?)"
  fi
}

assert_scan_fails() {
  local scanner="$1" work="$2" description="$3"
  if run_scan "$scanner" "$work"; then
    record no "$description — the scan passed and should not have"
  else
    record yes "$description"
  fi
}

assert_output_contains() {
  local needle="$1" description="$2"
  if printf '%s' "$LAST_OUTPUT" | grep -qF "$needle"; then
    record yes "$description"
  else
    record no "$description — no '$needle' in the output"
  fi
}

# @scenario "A secret on an unrelated branch does not fail the pull request"
test_secret_on_an_unrelated_branch_does_not_fail_the_pull_request() {
  local work
  work="$(build_checkout unrelated-branch other-branch)"
  assert_scan_passes trufflehog "$work" \
    "trufflehog ignores a secret that lives only on another branch"
}

# @scenario "A secret already on the base branch does not fail the pull request"
test_secret_on_the_base_branch_does_not_fail_the_pull_request() {
  local work
  work="$(build_checkout base-branch base)"
  assert_scan_passes trufflehog "$work" \
    "trufflehog ignores a secret that was already on the base branch"
}

# @scenario "A secret the pull request adds fails the check"
test_secret_added_by_the_pull_request_fails_the_check() {
  local work
  work="$(build_checkout pr-adds pr)"
  assert_scan_fails trufflehog "$work" \
    "trufflehog fails on a secret the pull request itself adds"
  assert_output_contains "pr-leak.env" \
    "the failure names the file the secret is in"
}

# @scenario "A secret the pull request adds and then deletes still fails the check"
test_secret_added_then_deleted_within_the_pull_request_still_fails() {
  local work
  work="$(build_checkout pr-adds-then-deletes pr-then-deleted)"
  assert_scan_fails trufflehog "$work" \
    "trufflehog fails on a secret that is added and removed inside the same pull request"
}

# @scenario "A shell function name is not a credential"
#
# The one case that runs with verification on, because the Lob detector reports
# nothing without it: offline, the match is suppressed, and the assertion would
# hold with or without the exclusion. Running the gate as CI runs it is what
# makes this observable at all.
#
# It reaches Lob's API to do so. With no network the detector cannot confirm
# anything and the case degrades to passing vacuously rather than to a red
# check, which is the right way round for a test that is not itself the gate.
test_shell_function_names_do_not_fail_the_check() {
  local work
  work="$(build_checkout pr-shell-functions pr-shell-functions)"
  SCAN_MODE=""
  assert_scan_passes trufflehog "$work" \
    "trufflehog does not report a test_* shell function as a Lob key"
  SCAN_MODE="offline"
}

# Runs the gate with a stubbed scanner that reports a clean, entirely empty
# scan — the shape a mis-aimed scope produces, and the one that is
# indistinguishable from a real pass by exit code alone.
run_scan_with_empty_stub() {
  local scanner="$1" work="$2" stub rc=0
  stub="$WORKSPACE/stub-bin-$scanner"
  mkdir -p "$stub"
  case "$scanner" in
    trufflehog)
      cat >"$stub/trufflehog" <<'STUB'
#!/usr/bin/env bash
echo 'info-0 trufflehog finished scanning {"chunks": 0, "bytes": 0, "verified_secrets": 0}'
exit 0
STUB
      ;;
    gitleaks)
      cat >"$stub/gitleaks" <<'STUB'
#!/usr/bin/env bash
echo '12:00AM INF 0 commits scanned.'
echo '12:00AM INF no leaks found'
exit 0
STUB
      ;;
  esac
  chmod +x "$stub"/*

  set +e
  LAST_OUTPUT="$(
    PATH="$stub:$PATH" \
      EVENT_NAME=pull_request \
      BASE_REF=main \
      SECRETS_SCAN_TRUFFLEHOG_MODE=offline \
      bash "$SCAN" "$scanner" "$work" 2>&1
  )"
  rc=$?
  set -e
  return $rc
}

# @scenario "A scan that examines no content while the pull request changes files fails loudly"
test_scan_that_examines_no_content_fails_loudly() {
  local work
  work="$(build_checkout vacuous none)"

  if run_scan_with_empty_stub trufflehog "$work"; then
    record no "an empty trufflehog scan over a non-empty pull request is a failure"
  else
    record yes "an empty trufflehog scan over a non-empty pull request is a failure"
  fi
  assert_output_contains "reached no commits" \
    "the failure says the scan reached no commits"

  # The same safeguard covers gitleaks — the spec rule is "both scanners are
  # scoped the same way", and a scope can be mis-aimed on either.
  if run_scan_with_empty_stub gitleaks "$work"; then
    record no "an empty gitleaks scan over a non-empty pull request is a failure"
  else
    record yes "an empty gitleaks scan over a non-empty pull request is a failure"
  fi
}

# @scenario "The pattern scanner ignores a secret on an unrelated branch"
test_pattern_scanner_ignores_a_secret_on_an_unrelated_branch() {
  local work
  work="$(build_checkout gitleaks-unrelated other-branch)"
  assert_scan_passes gitleaks "$work" \
    "gitleaks ignores a secret that lives only on another branch"
}

# @scenario "The pattern scanner still fails on a secret the pull request adds"
test_pattern_scanner_fails_on_a_secret_the_pull_request_adds() {
  local work
  work="$(build_checkout gitleaks-pr pr)"
  assert_scan_fails gitleaks "$work" \
    "gitleaks fails on a secret the pull request itself adds"
}

require_tool git
require_tool gitleaks
require_tool trufflehog

test_secret_on_an_unrelated_branch_does_not_fail_the_pull_request
test_secret_on_the_base_branch_does_not_fail_the_pull_request
test_secret_added_by_the_pull_request_fails_the_check
test_secret_added_then_deleted_within_the_pull_request_still_fails
test_shell_function_names_do_not_fail_the_check
test_scan_that_examines_no_content_fails_loudly
test_pattern_scanner_ignores_a_secret_on_an_unrelated_branch
test_pattern_scanner_fails_on_a_secret_the_pull_request_adds

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1
exit 0

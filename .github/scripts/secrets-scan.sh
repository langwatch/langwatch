#!/usr/bin/env bash
#
# The blocking secrets gate, scoped to the commits under test and nothing else.
#
#   secrets-scan.sh <gitleaks|trufflehog> [repository-path]
#
# Environment:
#   EVENT_NAME  github.event_name. Defaults to $GITHUB_EVENT_NAME.
#   BASE_REF    github.base_ref. Required when EVENT_NAME is `pull_request`.
#   SECRETS_SCAN_TRUFFLEHOG_MODE
#               `offline` drops verification and reports unverified matches.
#               The gate itself never sets this — see the comment on
#               trufflehog_flags below for why the tests must.
#
# Both scanners used to be invoked inline in code-scanners.yml, and only one of
# them was scoped. They live here together so the range is computed once, and so
# the scoping can be tested — see __tests__/secrets-scan.test.sh.

set -euo pipefail

scanner="${1:?usage: secrets-scan.sh <gitleaks|trufflehog> [repository-path]}"
repository="${2:-$PWD}"
cd "$repository"

event="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"

# The scan range, as one local ref.
#
# TruffleHog resolves `--branch` inside a fresh clone it makes of this working
# copy, and `git clone` carries refs/heads/*. On a pull request actions/checkout
# leaves HEAD DETACHED at refs/remotes/pull/N/merge with refs/heads/* empty, so
# there is no branch name to hand it — this creates the only one that matters.
scan_branch="__secrets-scan-head"
git branch --force "$scan_branch" HEAD >/dev/null

if [ "$event" = "pull_request" ]; then
  base_ref="${BASE_REF:?BASE_REF is required on a pull_request}"
  # actions/checkout with fetch-depth: 0 already brings this ref, so in CI the
  # fetch is a freshness refresh, not a requirement. It must not fail the gate
  # when the ref is already present: under `set -e` a transient network error
  # (or a credential-less fetch on a private fork) would otherwise paint a red
  # check that has nothing to do with secrets.
  git fetch --no-tags --quiet origin "+refs/heads/$base_ref:refs/remotes/origin/$base_ref" \
    || git rev-parse --verify --quiet "refs/remotes/origin/$base_ref" >/dev/null \
    || { echo "::error::cannot fetch or resolve base ref $base_ref" >&2; exit 1; }
  base_commit="$(git merge-base "$scan_branch" "origin/$base_ref")"
else
  base_commit=""
fi

# TruffleHog verifies candidates against the provider, so `--only-verified`
# is what makes a blocking gate affordable: a rotated credential in old history
# does not stop the queue. Nothing planted by a test can ever verify, though,
# and a test that could only assert "no verified secrets found" would pass
# whether the scan was correctly scoped or scanned nothing at all. `offline`
# turns verification off and reports the matches themselves, so the tests can
# assert on WHICH COMMITS were scanned — the property this script exists for.
trufflehog_flags=(--only-verified)
if [ "${SECRETS_SCAN_TRUFFLEHOG_MODE:-}" = "offline" ]; then
  trufflehog_flags=(--no-verification "--results=verified,unknown,unverified")
fi

# A scan can be scoped to nothing as easily as to the wrong thing, and both
# report the same green check. If the range under test adds or modifies a file,
# the scanner has to have read something. `$1` is the scanner's parsed
# work-done counter — chunks for trufflehog, commits for gitleaks; empty when
# the counter line was missing, which fails too (an unparseable report proves
# as little as an empty one).
assert_scan_was_not_empty() {
  local counted="$1"

  [ -n "$base_commit" ] || return 0
  git diff --quiet --diff-filter=AM "$base_commit" "$scan_branch" && return 0

  if [ -n "$counted" ] && [ "$counted" -gt 0 ]; then
    return 0
  fi

  echo "::error::Secrets scan reached no commits, but ${base_commit:0:12}..HEAD adds or modifies files." >&2
  echo "The gate examined nothing and would have passed regardless of content. Failing instead." >&2
  return 1
}

case "$scanner" in
  gitleaks)
    # --verbose because without it gitleaks prints only "leaks found: N" and
    # nothing about WHERE, which makes a blocking gate impossible to act on
    # from the log alone. --redact keeps the matched value itself out of CI
    # output; the file, line, rule id and fingerprint still print, which is what
    # an author needs — and rule + path is exactly what a `.gitleaks.toml` entry
    # is keyed on.
    if [ "$event" = "pull_request" ]; then
      log_opts="origin/$base_ref..$scan_branch"
    else
      log_opts="-1"
    fi
    set +e
    output="$(gitleaks git --redact --no-banner --no-color --verbose --log-opts="$log_opts" . 2>&1)"
    status=$?
    set -e
    printf '%s\n' "$output"

    # gitleaks reports "N commits scanned." where trufflehog reports chunks.
    commits="$(printf '%s' "$output" | sed -n 's/.*INF \([0-9][0-9]*\) commits scanned.*/\1/p' | tail -1)"
    assert_scan_was_not_empty "$commits" || exit 1
    exit "$status"
    ;;

  trufflehog)
    # `--branch` is the scope. Without it TruffleHog's git source shells out to
    # `git log --all` — every ref in the clone, including branches belonging to
    # other people's pull requests. `--since-commit` is not a substitute: it
    # only stops the walk on reaching that exact commit, and `--all` interleaves
    # other refs' newer commits ahead of it, so they are scanned first. That is
    # how one branch's finding came to fail every open pull request (#6681).
    args=(git "file://$PWD" --branch "$scan_branch" --fail --no-update "${trufflehog_flags[@]}")
    if [ -n "$base_commit" ]; then
      args+=(--since-commit "$base_commit")
    else
      args+=(--max-depth=1)
    fi

    set +e
    output="$(trufflehog "${args[@]}" 2>&1)"
    status=$?
    set -e
    printf '%s\n' "$output"

    chunks="$(printf '%s' "$output" | sed -n 's/.*"chunks": *\([0-9][0-9]*\).*/\1/p' | tail -1)"
    assert_scan_was_not_empty "$chunks" || exit 1
    exit "$status"
    ;;

  *)
    echo "unknown scanner: $scanner (expected gitleaks or trufflehog)" >&2
    exit 2
    ;;
esac

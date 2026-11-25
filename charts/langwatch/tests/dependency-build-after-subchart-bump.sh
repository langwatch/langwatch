#!/usr/bin/env bash
#
# Asserts the umbrella chart builds its dependencies after a release bumps the
# version of its file:// subcharts (gateway, langyagent, clickhouse-serverless),
# which is what release-please does on every release. A committed Chart.lock
# pins those subcharts at their previous versions and fails this build with
# "can't get a valid version for dependency <name>".
#
# Each test that binds to a feature scenario carries a "# @scenario \"...\"" line.
#
# Usage (from charts/langwatch, with the prometheus-community repo added):
#   ./tests/dependency-build-after-subchart-bump.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
lock_tracked=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# @scenario "The umbrella chart has no committed Chart.lock"
test_no_committed_lock() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  if [ -n "$(git ls-files -- Chart.lock)" ]; then
    lock_tracked=1
    fail "no committed lock" "charts/langwatch/Chart.lock is tracked by git; remove it (git rm --cached charts/langwatch/Chart.lock)"
  fi
}

# @scenario "Dependencies build after a release bumps every file subchart version"
test_dependency_build_after_subchart_bump() {
  local work
  work="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand now, the variable is local
  trap "rm -rf '$work'" RETURN

  # Copy the umbrella and every sibling chart so file://../<dir> resolves the
  # same way it does in the repository. Built archives are left behind so the
  # build has to resolve every subchart again.
  local dir
  for dir in ../*/; do
    [ -f "${dir}Chart.yaml" ] || continue
    cp -R "${dir%/}" "$work/"
    rm -rf "$work/$(basename "$dir")/charts"
  done
  # A lock that exists only in this checkout (a local `helm dependency update`)
  # is ignored by git and is not what CI or the release workflow sees. A
  # tracked lock stays, so the build below fails the way the release did.
  if [ "$lock_tracked" -eq 0 ]; then
    rm -f "$work/langwatch/Chart.lock"
  fi

  local bumped=() name repository subchart_dir new_version
  while read -r name repository; do
    subchart_dir="$work/langwatch/${repository#file://}"
    if [ ! -f "$subchart_dir/Chart.yaml" ]; then
      fail "subchart bump" "$name: $repository has no Chart.yaml"
      continue
    fi
    new_version="99.$RANDOM.0"
    perl -pi -e "s/^version:.*/version: $new_version/" "$subchart_dir/Chart.yaml"
    bumped+=("$name-$new_version.tgz")
  done < <(helm dependency list "$work/langwatch" 2>/dev/null |
    awk -F'\t' '{ gsub(/ /, "", $1); gsub(/ /, "", $3) } $3 ~ /^file:\/\// { print $1, $3 }')

  if [ "${#bumped[@]}" -eq 0 ]; then
    fail "subchart bump" "found no file:// dependencies in charts/langwatch/Chart.yaml"
    return
  fi

  local build_output archive
  if ! build_output="$(helm dependency build "$work/langwatch" 2>&1)"; then
    fail "dependency build" "helm dependency build failed after the subchart bump: $build_output"
    return
  fi
  for archive in "${bumped[@]}"; do
    [ -f "$work/langwatch/charts/$archive" ] ||
      fail "dependency build" "expected $archive after the build, got: $(cd "$work/langwatch/charts" && echo *)"
  done
  echo "bumped and built ${#bumped[@]} file:// subchart(s)"
}

test_no_committed_lock
test_dependency_build_after_subchart_bump

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "OK: dependency-build-after-subchart-bump"

#!/usr/bin/env bash
# Prints `source=git|git-sha|force`: where .github/actions/detect-changes reads
# a run's changed paths. Reads EVENT_NAME and PUSH_STRATEGY.
# Spec: specs/ci/path-filters.feature ("The gate never under-reports").

set -euo pipefail

case "${EVENT_NAME:-}" in
  pull_request | pull_request_target)
    # Merge base to head, so only the pull request's own commits count. The
    # event's base SHA can be older than the main the merge commit is built on,
    # and diffing it against that merge commit counted main's new commits too.
    # Fetched by SHA as objects only: .github/scripts/detect-changes-by-sha.sh,
    # which forces every filter on any failure.
    source=git-sha
    ;;
  push)
    if [ "${PUSH_STRATEGY:-force}" = "diff" ]; then
      source=git
    else
      source=force
    fi
    ;;
  *)
    source=force
    ;;
esac

echo "source=$source"

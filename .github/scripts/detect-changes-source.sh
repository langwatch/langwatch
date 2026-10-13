#!/usr/bin/env bash
# Prints `source=git|git-sha|force`: where .github/actions/detect-changes reads
# a run's changed paths. Reads EVENT_NAME and PUSH_STRATEGY.
# Spec: specs/ci/path-filters.feature ("The gate never under-reports").

set -euo pipefail

case "${EVENT_NAME:-}" in
  pull_request)
    source=git
    ;;
  pull_request_target)
    # The head is fetched by SHA as objects only and never checked out:
    # .github/scripts/detect-changes-by-sha.sh, which forces on any failure.
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

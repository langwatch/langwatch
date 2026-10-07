#!/usr/bin/env bash
# Prints `source=git|api|force`: where .github/actions/detect-changes reads a
# run's changed paths. Reads EVENT_NAME, PUSH_STRATEGY and CHANGED_FILES.
# Spec: specs/ci/path-filters.feature ("The gate never under-reports").

set -euo pipefail

# GitHub's list-files API returns at most this many files for a pull request.
API_FILE_LIMIT=3000

case "${EVENT_NAME:-}" in
  pull_request)
    source=git
    ;;
  pull_request_target)
    # The fork's commits are never fetched here, so only the API can answer,
    # and past its cap it answers with a subset. A missing count is no better.
    if [[ "${CHANGED_FILES:-}" =~ ^[0-9]+$ ]] && [ "$CHANGED_FILES" -lt "$API_FILE_LIMIT" ]; then
      source=api
    else
      source=force
    fi
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

#!/usr/bin/env bash
# Print "true" when ECR repository $1 holds tag $2, "false" when it does not.
# Only ImageNotFoundException means "not there". Any other error is printed
# and fails, so a caller never skips or pushes on a lookup that did not answer.
#   ecr-tag-exists.sh <repository> <tag>
set -euo pipefail

repository="${1:?repository name required}"
tag="${2:?tag required}"
err_file="$(mktemp)"
trap 'rm -f "${err_file}"' EXIT

if aws ecr describe-images --repository-name "${repository}" --image-ids imageTag="${tag}" \
    >/dev/null 2>"${err_file}"; then
  echo true
elif grep -q ImageNotFoundException "${err_file}"; then
  echo false
else
  cat "${err_file}" >&2
  echo "::error::could not look up ${repository}:${tag} in ECR" >&2
  exit 1
fi

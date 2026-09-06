#!/usr/bin/env bash
# Starts an ssh-agent holding the boxd CI key for the preview-VM jobs in
# boxd-pr-preview.yml. Extracted from four verbatim copies of the same block
# (#5300), and kept as a script rather than inline composite-action shell so
# __tests__/start-boxd-ssh-agent.test.sh can drive the real thing instead of a
# copy of it.
#
# A missing key is not a failure. Forks and secret-less environments are
# expected, so the run degrades: BOXD_SKIP=true goes into the environment and
# every later step opts out through `if: env.BOXD_SKIP != 'true'`. A key that
# is present but unusable IS a failure, because that is a broken secret rather
# than an absent one, and skipping quietly would read as "no preview
# configured" forever.
#
# Env in:
#   BOXD_SSH_KEY   private key for the boxd host; empty or unset means skip
#   SKIPPED_STEPS  what the warning names as skipped, e.g. "preview VM steps"
#   BOXD_SSH_HOST  host to add to known_hosts (default boxd.sh)
#   GITHUB_ENV     set by the runner; the file later steps read their env from
set -euo pipefail

skipped_steps="${SKIPPED_STEPS:-preview VM steps}"
boxd_host="${BOXD_SSH_HOST:-boxd.sh}"

if [ -z "${BOXD_SSH_KEY:-}" ]; then
  echo "BOXD_SKIP=true" >> "$GITHUB_ENV"
  echo "::warning::BOXD_SSH_KEY is not configured; ${skipped_steps} skipped"
  exit 0
fi

mkdir -p ~/.ssh
ssh-keyscan -T 10 "$boxd_host" >> ~/.ssh/known_hosts 2>/dev/null

eval "$(ssh-agent -s)"
echo "SSH_AUTH_SOCK=$SSH_AUTH_SOCK" >> "$GITHUB_ENV"
# preview-up exported the pid and the other three did not, so on those the
# agent outlived the job with nothing able to name it. Exporting it everywhere
# is the drift the four copies were hiding.
echo "SSH_AGENT_PID=$SSH_AGENT_PID" >> "$GITHUB_ENV"

printf '%s\n' "$BOXD_SSH_KEY" | ssh-add -

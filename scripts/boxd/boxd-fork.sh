#!/bin/bash
# scripts/boxd/boxd-fork.sh
# =========================
#
# Fork a Boxd golden image into a per-PR test VM. The fork inherits the
# golden's filesystem (including a cached node_modules and a pre-pulled
# docker image set), so first boot is ~30s instead of the ~5min a fresh
# `create-golden.sh` takes.
#
# Previously this script lived only on the golden VM at ~/boxd-fork.sh —
# untracked, unreviewed, and impossible to evolve with the codebase
# (#3203).
#
# Usage:
#   scripts/boxd/boxd-fork.sh <pr-number> [--from <golden-name>]
#   scripts/boxd/boxd-fork.sh 1234
#   scripts/boxd/boxd-fork.sh 1234 --from langwatch-main-alice
#
# The fork name is derived: pr-1234 by default, or pr-1234-from-<golden>
# when a non-default golden is used (so multiple contributors can fork
# the same PR in parallel without colliding).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_GOLDEN="langwatch-main"

# --- Pure functions (testable) ---------------------------------------------

# derive_fork_name: produce the fork VM name from <pr> + <golden>.
# Default golden -> "pr-<n>"; non-default -> "pr-<n>-<golden-suffix>".
derive_fork_name() {
  local pr="$1"
  local golden="${2:-$DEFAULT_GOLDEN}"
  if [ "$golden" = "$DEFAULT_GOLDEN" ]; then
    printf 'pr-%s' "$pr"
  else
    # Strip the leading "langwatch-main-" if present, else use the full name
    local suffix="${golden#langwatch-main-}"
    printf 'pr-%s-%s' "$pr" "$suffix"
  fi
}

# derive_hostname: <name> -> <name>.boxd.sh
derive_hostname() {
  local name="$1"
  printf '%s.boxd.sh' "$name"
}

# --- Orchestration (side-effecting) ----------------------------------------

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/boxd/boxd-fork.sh <pr-number> [--from <golden-name>]

Forks the golden Boxd VM into a per-PR test VM, retargets BASE_HOST /
NEXTAUTH_URL / LANGWATCH_ENDPOINT at the fork's hostname, and restarts
the dev stack so the change takes effect.

Examples:
  scripts/boxd/boxd-fork.sh 1234
  scripts/boxd/boxd-fork.sh 1234 --from langwatch-main-alice
USAGE
}

main() {
  if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
    usage
    exit 1
  fi

  local pr=""
  local golden="$DEFAULT_GOLDEN"

  while [ $# -gt 0 ]; do
    case "$1" in
      --from)
        golden="${2:-}"
        if [ -z "$golden" ]; then
          echo "Error: --from requires a value" >&2
          exit 1
        fi
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        if [ -z "$pr" ]; then
          pr="$1"
        else
          echo "Error: unexpected argument '$1'" >&2
          usage
          exit 1
        fi
        shift
        ;;
    esac
  done

  if [ -z "$pr" ]; then
    usage
    exit 1
  fi

  if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
    echo "Error: <pr-number> must be a positive integer (got '$pr')" >&2
    exit 1
  fi

  if ! command -v boxd >/dev/null 2>&1; then
    echo "Error: boxd CLI not on PATH. Install from https://boxd.sh" >&2
    exit 1
  fi

  local fork_name
  fork_name="$(derive_fork_name "$pr" "$golden")"
  local fork_host
  fork_host="$(derive_hostname "$fork_name")"

  echo "Forking $golden -> $fork_name (host: $fork_host)"

  # 1. boxd fork is fast (~30s) — it snapshots the golden's filesystem.
  boxd fork "$golden" "$fork_name"

  # 2. Retarget host-dependent env vars + check out the PR branch + restart.
  #    `gh pr checkout` is run inside the VM where the gh CLI is already
  #    authenticated against langwatch/langwatch.
  boxd exec "$fork_name" -- bash -s "$pr" "$fork_host" <<'REMOTE_SCRIPT'
set -euo pipefail
PR="$1"
FORK_HOST="$2"
cd ~/workspace/langwatch
gh pr checkout "$PR"

# Rewrite the host-dependent env vars in place. The rest of the .env
# (secrets, infra URLs) is inherited from the golden's already-rendered
# state — we only touch the three vars that name the fork itself.
ENV_FILE=langwatch/.env
for var in BASE_HOST NEXTAUTH_URL LANGWATCH_ENDPOINT; do
  if grep -q "^${var}=" "$ENV_FILE"; then
    sed -i "s|^${var}=.*|${var}=\"https://${FORK_HOST}\"|" "$ENV_FILE"
  else
    printf '\n%s="https://%s"\n' "$var" "$FORK_HOST" >> "$ENV_FILE"
  fi
done

# Restart so the new BASE_HOST is picked up by both NextAuth and Vite.
make down || true
make dev
echo "PR fork ready: https://${FORK_HOST}"
REMOTE_SCRIPT

  cat <<DONE

PR fork '$fork_name' ready.
  HTTPS:  https://$fork_host
  SSH:    boxd ssh $fork_name
  Tear-down when done: boxd destroy $fork_name
DONE
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi

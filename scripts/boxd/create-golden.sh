#!/bin/bash
# scripts/boxd/create-golden.sh
# =============================
#
# Provision a fresh Boxd golden image for LangWatch. The golden VM is
# the fork source for every per-PR test VM; boxd-fork.sh clones it.
#
# Goal: the golden's first-boot state is committed-and-reviewed, not
# tribal knowledge living on one engineer's VM.
#
# Usage:
#   scripts/boxd/create-golden.sh <name>
#   scripts/boxd/create-golden.sh langwatch-main
#   scripts/boxd/create-golden.sh langwatch-main-andrew   # personal golden
#
# Prereqs (must be installed locally):
#   - boxd CLI       (https://boxd.sh — `boxd --help`)
#   - openssl        (for per-VM secret generation)
#
# The script is idempotent on success but does not auto-destroy an
# existing VM with the same name — refuses and points at `boxd destroy`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE="$SCRIPT_DIR/.env.golden.template"

# --- Pure functions (testable) ---------------------------------------------

# generate_secret: produce one 64-hex-char secret. Wrapped so tests can stub.
generate_secret() {
  openssl rand -hex 32
}

# render_env: substitute placeholders in the template into langwatch/.env
# content. Reads the template from stdin, writes rendered output to stdout.
#
# Args:
#   $1 = BOXD_HOST  (e.g. "langwatch-main.boxd.sh")
#
# Behavior:
#   - Replaces ${BOXD_HOST} with the supplied hostname.
#   - Replaces every PLACEHOLDER_REGENERATE_ME with a freshly generated
#     64-hex secret (each occurrence gets its own value).
render_env() {
  local boxd_host="$1"
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    # Substitute ${BOXD_HOST}
    line="${line//\$\{BOXD_HOST\}/$boxd_host}"
    # Substitute every PLACEHOLDER_REGENERATE_ME with a fresh secret
    while [[ "$line" == *PLACEHOLDER_REGENERATE_ME* ]]; do
      local secret
      secret="$(generate_secret)"
      line="${line/PLACEHOLDER_REGENERATE_ME/$secret}"
    done
    printf '%s\n' "$line"
  done
}

# derive_hostname: <name> -> <name>.boxd.sh
derive_hostname() {
  local name="$1"
  printf '%s.boxd.sh' "$name"
}

# --- Orchestration (side-effecting) ----------------------------------------

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/boxd/create-golden.sh <name>

Creates a Boxd VM named <name>, clones the langwatch repo, renders
.env from scripts/boxd/.env.golden.template, and boots the dev stack.

Examples:
  scripts/boxd/create-golden.sh langwatch-main           # the shared golden
  scripts/boxd/create-golden.sh langwatch-main-alice     # personal golden
USAGE
}

main() {
  if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
    usage
    exit 1
  fi

  local name="$1"

  # Sanity: name is kebab-ish (boxd's own validator will catch the rest).
  if ! [[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "Error: name must be lowercase letters, digits, hyphens (got '$name')" >&2
    exit 1
  fi

  if [ ! -f "$TEMPLATE" ]; then
    echo "Error: template not found at $TEMPLATE" >&2
    exit 1
  fi

  if ! command -v boxd >/dev/null 2>&1; then
    echo "Error: boxd CLI not on PATH. Install from https://boxd.sh" >&2
    exit 1
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "Error: openssl required for secret generation" >&2
    exit 1
  fi

  local hostname
  hostname="$(derive_hostname "$name")"

  echo "Creating golden VM: $name (host: $hostname)"

  # 1. Create the VM. boxd refuses if name is in use; let it surface that.
  boxd create "$name"

  # 2. Inside the VM: clone langwatch/langwatch, install Docker prereqs,
  #    drop in the rendered .env, start the dev stack.
  #
  # The HEREDOC is piped through boxd exec so the host shell does not
  # expand ${BOXD_HOST} etc. — those are rendered inside the VM by
  # `render_env`, which the in-VM script sources from this same file.
  local rendered_env
  rendered_env="$(render_env "$hostname" < "$TEMPLATE")"

  echo "Provisioning VM (this takes ~5 minutes for first-time clones)..."

  # Write the rendered .env into the VM. Single quotes around the HEREDOC
  # delimiter so $rendered_env is expanded on THIS host before being sent.
  boxd exec "$name" -- bash -s <<REMOTE_SCRIPT
set -euo pipefail
mkdir -p ~/workspace
cd ~/workspace
if [ ! -d langwatch ]; then
  git clone https://github.com/langwatch/langwatch.git
fi
cd langwatch
cat > langwatch/.env <<'ENV_EOF'
$rendered_env
ENV_EOF
# First-time setup: install deps, pull docker images, run migrations.
# Idempotent — re-runs are safe.
pnpm install --frozen-lockfile || true
make dev || true
echo "Golden VM \$(hostname) provisioned. App should be at: https://$hostname"
REMOTE_SCRIPT

  cat <<DONE

Golden image '$name' created.
  HTTPS:  https://$hostname
  Fork:   scripts/boxd/boxd-fork.sh <pr> --from $name

Next steps (manual, since LLM provider keys must NOT live in this repo):
  1. SSH in:                 boxd ssh $name
  2. Edit langwatch/.env to inject OPENAI_API_KEY / ANTHROPIC_API_KEY
  3. Restart the dev stack:  cd ~/workspace/langwatch && make down && make dev
DONE
}

# Only run main when executed directly (not sourced — lets tests
# exercise the pure functions in isolation).
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi

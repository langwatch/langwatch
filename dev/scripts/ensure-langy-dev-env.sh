#!/usr/bin/env bash
# Ensure .env carries the Langy settings a local stack needs, so `pnpm dev`
# starts the agent manager instead of skipping it.
#
# Each of these has exactly one sensible local value, and until now every one of
# them was a line the developer copied out of `dev/scripts/dogfood/langy-local.sh`
# by hand. Missing any one costs a different distant symptom: the lane skips,
# the manager exits at boot, the panel never renders, or a turn dies inside the
# worker pool with an EPERM nobody sees.
#
#   LANGY_INTERNAL_SECRET               shared bearer between the control plane
#                                       and the manager; both are local, so the
#                                       value only has to agree with itself
#   LANGY_UNSAFE_DEV_DISABLE_ISOLATION  the ADR-033 per-worker UID sandbox needs
#                                       root and CAP_SETUID; a laptop process
#                                       has neither, and every spawn fails EPERM
#   SESSIONS_ROOT / LANGY_WORKSPACE_ROOT  the manager's defaults are the
#                                       container's (/workspace), which cannot
#                                       be created at the filesystem root
#   FEATURE_FLAG_FORCE_ENABLE           release_langy_enabled is SYSTEM-scoped
#                                       and off by default, so the panel is
#                                       hidden until it is forced on
#
# Behaviour, matching ensure-ai-gateway-secrets.sh beside it:
#   - Idempotent: only a missing or empty value is written.
#   - Non-destructive: a value the developer chose is never overwritten, and the
#     forced-flag list is added to rather than replaced.
#   - Development only: refuses to write anything when NODE_ENV is production.
#   - Skipped when .env does not exist — the env-files check fires first and
#     points at .env.example, which is the better first message.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

. "$(cd "$(dirname "$0")" && pwd)/lib/env-file-keys.sh"

# The bypass below trades away per-worker isolation, and the flag opens a
# rollout gate. Both are for the machine that owns the code, so the refusal is
# by environment rather than by a flag anyone can pass.
if [ "${NODE_ENV:-development}" = "production" ]; then
  echo "  ! langyagent: the local Langy settings are for development only, writing none (NODE_ENV=production)"
  exit 0
fi

[ -f "$ENV_FILE" ] || exit 0

# Per worktree, so two checkouts never share a session tree, and outside the
# repo so a materialized skills tree and a worker's home are not something
# `git status` has an opinion about.
LANGY_LOCAL_ROOT="${HOME}/.langwatch-langy/$(basename "$REPO_ROOT")"

written=0

note() {
  printf '  generated %s\n' "$1"
  written=$((written + 1))
}

if env_file_key_is_empty_or_missing "$ENV_FILE" LANGY_INTERNAL_SECRET; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: openssl not found — cannot generate LANGY_INTERNAL_SECRET." >&2
    echo "       Install openssl, or set it manually in $ENV_FILE." >&2
    exit 1
  fi
  secret=$(openssl rand -hex 32)
  env_file_set_key "$ENV_FILE" LANGY_INTERNAL_SECRET "$secret"
  note "LANGY_INTERNAL_SECRET (32 random hex bytes)"
fi

if env_file_key_is_empty_or_missing "$ENV_FILE" LANGY_UNSAFE_DEV_DISABLE_ISOLATION; then
  env_file_set_key "$ENV_FILE" LANGY_UNSAFE_DEV_DISABLE_ISOLATION true
  note "LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true (the manager refuses this outside a local environment)"
fi

if env_file_key_is_empty_or_missing "$ENV_FILE" SESSIONS_ROOT; then
  env_file_set_key "$ENV_FILE" SESSIONS_ROOT "\"${LANGY_LOCAL_ROOT}/sessions\""
  note "SESSIONS_ROOT=${LANGY_LOCAL_ROOT}/sessions"
fi

if env_file_key_is_empty_or_missing "$ENV_FILE" LANGY_WORKSPACE_ROOT; then
  env_file_set_key "$ENV_FILE" LANGY_WORKSPACE_ROOT "\"${LANGY_LOCAL_ROOT}/workspace\""
  note "LANGY_WORKSPACE_ROOT=${LANGY_LOCAL_ROOT}/workspace"
fi

# Added to the list rather than assigned over it: a developer forcing other
# flags on for their own work would otherwise lose them to a stack restart.
LANGY_FLAG=release_langy_enabled
forced=$(env_file_key_value "$ENV_FILE" FEATURE_FLAG_FORCE_ENABLE || true)
case ",${forced}," in
  *",${LANGY_FLAG},"*) ;;
  *)
    env_file_set_key "$ENV_FILE" FEATURE_FLAG_FORCE_ENABLE \
      "\"${forced:+${forced},}${LANGY_FLAG}\""
    note "FEATURE_FLAG_FORCE_ENABLE += ${LANGY_FLAG} (the panel is hidden without it)"
    ;;
esac

if [ "$written" -gt 0 ]; then
  printf 'Wrote %s Langy development setting(s) to %s.\n' "$written" "$ENV_FILE"
fi

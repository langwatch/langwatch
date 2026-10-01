#!/usr/bin/env bash
#
# Renders the chart and asserts the self-hosted privacy defaults: the env vars
# that switch off a third-party call a library would otherwise make at runtime
# (Prisma's checkpoint, the voice cloudflared quick tunnel, RAGAS analytics,
# LiteLLM's remote price list). A default install must carry each one on the
# workload that would make the call, and an operator who names the same
# variable in that component's extraEnvs must get exactly their value, once.
#
# Each test carries a plain "# Verifies:" line naming what it pins.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/privacy-defaults.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

render_to() {
  local out="$1" err="$2" release="$3"
  shift 3
  local status
  helm template "$release" . "$@" >"$out" 2>"$err" && status=0 || status=$?
  return $status
}

# "name=value" for every env entry inside ONE workload's Source block.
env_pairs_in() {
  local render="$1" src="$2"
  awk -v want="$src" '
    /^# Source:/ { insrc = (index($0, want) > 0); next }
    insrc && /^[[:space:]]*- name:[[:space:]]/ {
      name = $0; sub(/^[[:space:]]*- name:[[:space:]]*/, "", name)
      if ((getline line) > 0 && line ~ /^[[:space:]]*value:/) {
        sub(/^[[:space:]]*value:[[:space:]]*/, "", line); gsub(/"/, "", line)
        print name "=" line
      } else {
        print name "="
      }
    }
  ' "$render"
}

# The values of $2 in $1 (newline-separated name=value pairs), one per line.
values_of() {
  printf '%s\n' "$1" | awk -F= -v want="$2" '$1 == want { sub(/^[^=]*=/, ""); print }'
}

expect_once() {
  local id="$1" pairs="$2" var="$3" expected="$4" workload="$5"
  local values count
  values="$(values_of "$pairs" "$var")"
  count="$(printf '%s' "$values" | grep -c . || true)"
  if [[ "$count" != "1" ]]; then
    fail "$id" "$workload carries $var $count time(s), expected once."
    return
  fi
  if [[ "$values" != "$expected" ]]; then
    fail "$id" "$workload has $var='$values', expected '$expected'."
  fi
}

# Verifies: a default install switches off every third-party call it would make
test_defaults() {
  local out="${TMPDIR:-/tmp}/privacy-default.yaml"
  local err="${TMPDIR:-/tmp}/privacy-default.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "default-render" "default render failed:
$(cat "$err")"
    return
  fi

  local app workers langevals
  app="$(env_pairs_in "$out" "app/deployment.yaml")"
  workers="$(env_pairs_in "$out" "workers/deployment.yaml")"
  langevals="$(env_pairs_in "$out" "langevals/deployment.yaml")"

  expect_once "app-checkpoint" "$app" CHECKPOINT_DISABLE 1 app
  expect_once "workers-checkpoint" "$workers" CHECKPOINT_DISABLE 1 workers
  expect_once "workers-voice-tunnel" "$workers" VOICE_TUNNEL false workers
  expect_once "langevals-ragas" "$langevals" RAGAS_DO_NOT_TRACK true langevals
  expect_once "langevals-litellm" "$langevals" LITELLM_LOCAL_MODEL_COST_MAP True langevals
}

# Verifies: naming a default in extraEnvs replaces it instead of duplicating it
test_extra_envs_override() {
  local out="${TMPDIR:-/tmp}/privacy-override.yaml"
  local err="${TMPDIR:-/tmp}/privacy-override.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set 'app.extraEnvs[0].name=CHECKPOINT_DISABLE' \
      --set-string 'app.extraEnvs[0].value=0' \
      --set 'workers.extraEnvs[0].name=VOICE_TUNNEL' \
      --set-string 'workers.extraEnvs[0].value=true' \
      --set 'langevals.extraEnvs[0].name=LITELLM_LOCAL_MODEL_COST_MAP' \
      --set-string 'langevals.extraEnvs[0].value=False' \
      --set 'langevals.extraEnvs[1].name=RAGAS_DO_NOT_TRACK' \
      --set-string 'langevals.extraEnvs[1].value=false'; then
    fail "override-render" "render with overrides failed:
$(cat "$err")"
    return
  fi

  local app workers langevals
  app="$(env_pairs_in "$out" "app/deployment.yaml")"
  workers="$(env_pairs_in "$out" "workers/deployment.yaml")"
  langevals="$(env_pairs_in "$out" "langevals/deployment.yaml")"

  expect_once "override-app-checkpoint" "$app" CHECKPOINT_DISABLE 0 app
  expect_once "override-workers-voice-tunnel" "$workers" VOICE_TUNNEL true workers
  expect_once "override-workers-checkpoint" "$workers" CHECKPOINT_DISABLE 1 workers
  expect_once "override-langevals-litellm" "$langevals" LITELLM_LOCAL_MODEL_COST_MAP False langevals
  expect_once "override-langevals-ragas" "$langevals" RAGAS_DO_NOT_TRACK false langevals
}

test_defaults
test_extra_envs_override

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: privacy defaults pinned: (1) a default render switches off Prisma's checkpoint on app and workers, the voice quick tunnel on workers, and RAGAS analytics and LiteLLM's remote price list on langevals; (2) an operator's extraEnvs entry replaces the default instead of duplicating it"

#!/usr/bin/env bash
#
# Renders the chart and asserts the workers container never carries a
# duplicate env name when app.extraEnvs and workers.extraEnvs set the same
# variable (specs/self-hosting/helm-workers-extra-envs.feature).
#
# Kubernetes accepts a duplicate env name on create, but the strategic merge
# patch `helm upgrade` sends refuses it ("doesn't match $setElementOrder
# list"), so an install with a duplicate cannot upgrade.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/workers-extra-envs.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

render_to() {
  local out="$1" err="$2"
  shift 2
  helm template t . --set autogen.enabled=true "$@" >"$out" 2>"$err"
}

# Every value emitted for `- name: <var>` in one component's Deployment, one per line.
env_values_of() {
  local render="$1" component="$2" var="$3"
  awk -v src="langwatch/templates/$component/deployment.yaml" -v want="$var" '
    /^# Source:/ { insrc = (index($0, src) > 0) }
    insrc && $0 ~ "- name: " want "$" { getline; sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print }
  ' "$render"
}

# @scenario "a variable set in both app and workers extraEnvs renders once on the workers container"
test_shared_name_renders_once_with_the_workers_value() {
  local out="${TMPDIR:-/tmp}/workers-extra-envs-shared.yaml"
  local err="${TMPDIR:-/tmp}/workers-extra-envs-shared.err"
  if ! render_to "$out" "$err" \
      --set 'app.extraEnvs[0].name=SHARED_FLAG' \
      --set-string 'app.extraEnvs[0].value=from-app' \
      --set 'workers.extraEnvs[0].name=SHARED_FLAG' \
      --set-string 'workers.extraEnvs[0].value=from-workers'; then
    fail "shared-render" "render failed:
$(cat "$err")"
    return
  fi

  local workers app
  workers="$(env_values_of "$out" workers SHARED_FLAG)"
  if [[ "$workers" != "from-workers" ]]; then
    fail "workers-once" "workers container SHARED_FLAG values are '$(echo "$workers" | paste -sd, -)', expected exactly 'from-workers'."
  fi
  app="$(env_values_of "$out" app SHARED_FLAG)"
  if [[ "$app" != "from-app" ]]; then
    fail "app-value" "app SHARED_FLAG values are '$(echo "$app" | paste -sd, -)', expected exactly 'from-app'."
  fi

  local dupes
  dupes="$(awk '
    /^# Source:/ { insrc = (index($0, "langwatch/templates/workers/deployment.yaml") > 0) }
    insrc && /^[[:space:]]*- name: [A-Z_][A-Z0-9_]*$/ { print $3 }
  ' "$out" | sort | uniq -d)"
  if [[ -n "$dupes" ]]; then
    fail "workers-unique" "workers Deployment repeats env names: $(echo "$dupes" | paste -sd, -)"
  fi
}

# @scenario "a variable set only in app extraEnvs still reaches the workers container"
test_app_only_name_reaches_the_workers() {
  local out="${TMPDIR:-/tmp}/workers-extra-envs-app-only.yaml"
  local err="${TMPDIR:-/tmp}/workers-extra-envs-app-only.err"
  if ! render_to "$out" "$err" \
      --set 'app.extraEnvs[0].name=APP_ONLY_FLAG' \
      --set-string 'app.extraEnvs[0].value=from-app'; then
    fail "app-only-render" "render failed:
$(cat "$err")"
    return
  fi
  local workers
  workers="$(env_values_of "$out" workers APP_ONLY_FLAG)"
  if [[ "$workers" != "from-app" ]]; then
    fail "app-only-reaches-workers" "workers APP_ONLY_FLAG values are '$(echo "$workers" | paste -sd, -)', expected exactly 'from-app'."
  fi
}

test_shared_name_renders_once_with_the_workers_value
test_app_only_name_reaches_the_workers

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi
echo "workers-extra-envs: all checks passed"

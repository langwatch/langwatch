#!/usr/bin/env bash
#
# Renders the chart and asserts the offline defaults: the env vars that switch
# off a third-party call a library would otherwise make at runtime (Prisma's
# checkpoint, the voice cloudflared quick tunnel, RAGAS analytics).
#
# They live in one ConfigMap that app, workers and langevals list FIRST in
# envFrom. Kubernetes lets a later envFrom source beat an earlier one and any
# env entry beat every envFrom source, so an operator's extraEnvs or
# extraEnvFrom always wins. Two things break that and are pinned here: the
# ConfigMap not being first, and a default leaking into `env`, where it would
# silently outrank a value the operator supplies through a Secret.
#
# Scenario bindings: specs/self-hosting/outbound/offline-defaults.feature.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/privacy-defaults.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

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

# One rendered document whose Source path contains $2.
doc_of() {
  awk -v want="$2" '
    /^---/ { insrc = 0 }
    /^# Source:/ { insrc = (index($0, want) > 0) }
    insrc { print }
  ' "$1"
}

# The envFrom entries of a workload, one "kind name" per line, in order.
env_from_of() {
  printf '%s\n' "$1" | awk '
    /^[[:space:]]*envFrom:/ { inside = 1; indent = match($0, /[^ ]/); next }
    inside {
      cur = match($0, /[^ ]/)
      if ($0 ~ /^[[:space:]]*$/) next
      if (cur <= indent) { inside = 0; next }
      if ($0 ~ /(configMapRef|secretRef):/) { kind = $0; gsub(/[[:space:]-]|:/, "", kind) }
      if ($0 ~ /name:/) { name = $0; sub(/.*name:[[:space:]]*/, "", name); print kind " " name }
    }
  '
}

# Names in a workload's env list.
env_names_of() {
  printf '%s\n' "$1" | awk '/^[[:space:]]*- name:[[:space:]]/ { sub(/^[[:space:]]*- name:[[:space:]]*/, ""); print }'
}

WORKLOADS=("app/deployment.yaml" "workers/deployment.yaml" "langevals/deployment.yaml")
DEFAULTS=("CHECKPOINT_DISABLE=1" "VOICE_TUNNEL=false" "RAGAS_DO_NOT_TRACK=true")

# @scenario "A default chart render switches off the third-party calls libraries would make"
test_defaults() {
  local out="$tmpdir/default.yaml" err="$tmpdir/default.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "default-render" "default render failed:
$(cat "$err")"
    return
  fi

  local cm pair key value actual
  cm="$(doc_of "$out" "offline-defaults-configmap.yaml")"
  for pair in "${DEFAULTS[@]}"; do
    key="${pair%%=*}"; value="${pair#*=}"
    actual="$(printf '%s\n' "$cm" | awk -v k="$key" '$1 == k ":" { v = $2; gsub(/"/, "", v); print v }')"
    if [[ "$actual" != "$value" ]]; then
      fail "configmap-$key" "the offline defaults ConfigMap has $key='${actual:-<missing>}', expected '$value'."
    fi
  done

  local workload doc first names
  for workload in "${WORKLOADS[@]}"; do
    doc="$(doc_of "$out" "$workload")"
    first="$(env_from_of "$doc" | head -n 1)"
    if [[ "$first" != "configMapRef t-offline-defaults" ]]; then
      fail "envfrom-first-$workload" "$workload lists '${first:-<nothing>}' first in envFrom, expected the offline defaults ConfigMap."
    fi
    names="$(env_names_of "$doc")"
    for pair in "${DEFAULTS[@]}"; do
      if printf '%s\n' "$names" | grep -qxF "${pair%%=*}"; then
        fail "env-leak-$workload-${pair%%=*}" "$workload sets ${pair%%=*} in env, which outranks any value the operator supplies through extraEnvFrom."
      fi
    done
  done
}

# @scenario "An operator's own value replaces an offline default"
test_operator_overrides() {
  local out="$tmpdir/override.yaml" err="$tmpdir/override.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set 'workers.extraEnvs[0].name=VOICE_TUNNEL' \
      --set-string 'workers.extraEnvs[0].value=true' \
      --set 'app.extraEnvFrom[0].secretRef.name=operator-env'; then
    fail "override-render" "render with overrides failed:
$(cat "$err")"
    return
  fi

  local workers app count order
  workers="$(doc_of "$out" "workers/deployment.yaml")"
  count="$(env_names_of "$workers" | grep -cxF VOICE_TUNNEL || true)"
  if [[ "$count" != "1" ]]; then
    fail "override-env" "workers carry VOICE_TUNNEL in env $count time(s), expected the operator's entry once."
  fi

  app="$(doc_of "$out" "app/deployment.yaml")"
  order="$(env_from_of "$app" | tr '\n' '|')"
  if [[ "$order" != "configMapRef t-offline-defaults|secretRef operator-env|" ]]; then
    fail "override-envfrom" "app envFrom is '$order', expected the offline defaults then the operator's Secret."
  fi
}

test_defaults
test_operator_overrides

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: offline defaults pinned: (1) the ConfigMap disables Prisma's checkpoint, the voice quick tunnel and RAGAS analytics, app, workers and langevals list it first in envFrom, and none sets those variables in env; (2) an operator's extraEnvs entry is carried once and an extraEnvFrom source comes after the defaults"

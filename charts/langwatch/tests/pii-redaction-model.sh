#!/usr/bin/env bash
# Asserts how the chart deploys the PII redaction model and wires the app and
# workers to it. See specs/setup/helm-pii-redaction-model.feature. Run from
# charts/langwatch after helm dependency build .

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1] $2"
  failures=$((failures + 1))
}

ok() {
  echo "ok   [$1]"
}

readonly BASE="--set autogen.enabled=true"
readonly ON="$BASE --set piiRedactionModel.enabled=true"
readonly SERVICE_URL="http://lw-pii-redaction-model:8080"

render() {
  # shellcheck disable=SC2086
  helm template lw . $1
}

# Prints only the documents rendered from templates whose path matches $2.
only() {
  printf '%s\n' "$1" | awk -v want="$2" '
    /^# Source:/ { grab = ($3 ~ want) }
    grab { print }
  '
}

# The value of the first env entry named $2 in the given YAML.
env_value() {
  printf '%s\n' "$1" | awk -v name="$2" '
    $0 ~ "- name: " name "$" { want=1; next }
    want && /value:/ { sub(/^[^:]*: */, ""); gsub(/"/, ""); print; want=0 }
  ' | head -n 1
}

# The templates that carry PII_REDACTION_MODEL_ENDPOINT, one per line, sorted.
endpoint_sources() {
  printf '%s\n' "$1" | awk '
    /^# Source:/ { src=$3 }
    /- name: PII_REDACTION_MODEL_ENDPOINT$/ { print src }
  ' | sort -u
}

# @scenario "The default install deploys no model and sets no endpoint"
test_default_install_has_no_model() {
  local out
  out=$(render "$BASE")
  if [ -n "$(only "$out" "pii_redaction_model/")" ]; then
    fail "default" "renders PII redaction model objects"
    return
  fi
  if [ -n "$(endpoint_sources "$out")" ]; then
    fail "default" "sets PII_REDACTION_MODEL_ENDPOINT on $(endpoint_sources "$out" | tr '\n' ' ')"
    return
  fi
  ok "default: no model, no endpoint"
}

# @scenario "Every size profile leaves the model off"
test_every_profile_is_off() {
  local profile out
  for profile in size-dev size-minimal size-prod size-ha; do
    out=$(render "$BASE -f examples/overlays/$profile.yaml")
    if [ -n "$(only "$out" "pii_redaction_model/")" ] || [ -n "$(endpoint_sources "$out")" ]; then
      fail "$profile" "renders the PII redaction model or its endpoint"
      continue
    fi
    ok "$profile: model off"
  done
}

# @scenario "Turned on, the prod and HA profiles run the model with its measured sizing"
test_prod_and_ha_profiles_when_enabled() {
  local profile replicas out deploy got_replicas memory pdb
  for pair in "size-prod:2" "size-ha:2"; do
    profile=${pair%%:*}
    replicas=${pair##*:}
    out=$(render "$BASE -f examples/overlays/$profile.yaml --set piiRedactionModel.enabled=true")
    deploy=$(only "$out" "pii_redaction_model/deployment")
    if [ -z "$deploy" ]; then
      fail "$profile" "renders no PII redaction model Deployment"
      continue
    fi
    got_replicas=$(printf '%s\n' "$deploy" | awk '/^  replicas:/ { print $2; exit }')
    if [ "$got_replicas" != "$replicas" ]; then
      fail "$profile" "replicas is '$got_replicas', expected $replicas"
      continue
    fi
    memory=$(printf '%s\n' "$deploy" | grep -cE '^ +memory: 7Gi$' || true)
    if [ "$memory" != "2" ]; then
      fail "$profile" "memory request and limit are not both 7Gi"
      continue
    fi
    pdb=$(only "$out" "pii_redaction_model/pdb")
    if [ -z "$pdb" ]; then
      fail "$profile" "renders no PodDisruptionBudget for $replicas replicas"
      continue
    fi
    if [ "$(endpoint_sources "$out" | tr '\n' ' ')" != "langwatch/templates/app/deployment.yaml langwatch/templates/workers/deployment.yaml " ]; then
      fail "$profile" "PII_REDACTION_MODEL_ENDPOINT is on: $(endpoint_sources "$out" | tr '\n' ' ')"
      continue
    fi
    if [ "$profile" = "size-ha" ] && ! printf '%s\n' "$deploy" | grep -A1 'matchLabelKeys:' | grep -q 'app.kubernetes.io/instance'; then
      fail "$profile" "zone spread does not match on app.kubernetes.io/instance"
      continue
    fi
    ok "$profile: $replicas replicas, PDB, 7Gi, endpoint on app and workers"
  done
}

# @scenario "The app and the workers get the chart's Service as PII_REDACTION_MODEL_ENDPOINT"
test_enabled_wires_app_and_workers_only() {
  local out sources app workers svc port
  out=$(render "$ON")
  sources=$(endpoint_sources "$out" | tr '\n' ' ')
  if [ "$sources" != "langwatch/templates/app/deployment.yaml langwatch/templates/workers/deployment.yaml " ]; then
    fail "endpoint owners" "PII_REDACTION_MODEL_ENDPOINT is on: ${sources:-<none>}"
    return
  fi
  app=$(env_value "$(only "$out" "app/deployment")" PII_REDACTION_MODEL_ENDPOINT)
  workers=$(env_value "$(only "$out" "workers/deployment")" PII_REDACTION_MODEL_ENDPOINT)
  if [ "$app" != "$SERVICE_URL" ] || [ "$workers" != "$SERVICE_URL" ]; then
    fail "endpoint value" "app '$app', workers '$workers', expected $SERVICE_URL"
    return
  fi
  svc=$(only "$out" "pii_redaction_model/service")
  port=$(printf '%s\n' "$svc" | awk '/- port:/ { print $3; exit }')
  if ! printf '%s\n' "$svc" | grep -q '^  name: lw-pii-redaction-model$' || [ "$port" != "8080" ]; then
    fail "service" "no Service lw-pii-redaction-model on port 8080"
    return
  fi
  ok "enabled: app and workers -> $SERVICE_URL, Service on 8080"
}

# @scenario "Deploying the model releases it for every organization"
test_flags_follow_the_toggles() {
  local flags
  flags=$(env_value "$(only "$(render "$ON")" "workers/deployment")" FEATURE_FLAG_FORCE_ENABLE)
  case ",$flags," in
    *,release_pii_redaction_model_free,*) fail "flags forced" "free flag forced: '$flags'" ;;
    *,release_pii_redaction_model_enabled,*) ok "routing flag forced, price left to the server: $flags" ;;
    *) fail "flags forced" "FEATURE_FLAG_FORCE_ENABLE is '$flags'" ;;
  esac
  flags=$(env_value "$(only "$(render "$BASE")" "workers/deployment")" FEATURE_FLAG_FORCE_ENABLE)
  case "$flags" in
    *release_pii_redaction_model*) fail "flags default" "forced without a model: '$flags'" ;;
    *) ok "no model, no PII flags: ${flags:-<unset>}" ;;
  esac
}

# @scenario "A model outside the release is reached through externalEndpoint"
test_external_endpoint() {
  local out got
  out=$(render "$BASE --set piiRedactionModel.externalEndpoint=http://pii.example:8080/")
  got=$(env_value "$(only "$out" "app/deployment")" PII_REDACTION_MODEL_ENDPOINT)
  if [ "$got" != "http://pii.example:8080/" ]; then
    fail "external" "app endpoint is '$got'"
    return
  fi
  if [ -n "$(only "$out" "pii_redaction_model/")" ]; then
    fail "external" "still deploys the model"
    return
  fi
  ok "external endpoint passed through, no model deployed"
}

# The forced flags on one workload of a render, as a comma-wrapped list.
flags_of() {
  printf ',%s,' "$(env_value "$(only "$(render "$1")" "$2/deployment")" FEATURE_FLAG_FORCE_ENABLE)"
}

# @scenario "An external model also releases it for every organization"
test_external_endpoint_forces_flags() {
  local ext="$BASE --set piiRedactionModel.externalEndpoint=http://pii.example:8080" kind flags
  for kind in app workers; do
    flags=$(flags_of "$ext" "$kind")
    case "$flags" in
      *,release_pii_redaction_model_enabled,*) ;;
      *) fail "external flags $kind" "no release_pii_redaction_model_enabled in '$flags'"; return ;;
    esac
  done
  ok "external endpoint forces the routing flag on app and workers"
}

# @scenario "The image, pull secrets and probes come from values and the image's contract"
test_image_secrets_probes() {
  local deploy probes release image
  # The release publishes langwatch/pii-redaction-model:<appVersion>, as for the app.
  release=$(awk '/^appVersion:/ { gsub(/["'\'']/, "", $2); print $2 }' Chart.yaml)
  deploy=$(only "$(render "$ON")" "pii_redaction_model/deployment")
  image=$(printf '%s\n' "$deploy" | awk '/^ *image: / { gsub(/"/, "", $2); print $2; exit }')
  if [ -z "$release" ] || [ "$image" != "langwatch/pii-redaction-model:$release" ]; then
    fail "default image" "'$image' is not langwatch/pii-redaction-model:$release, the chart's release"
    return
  fi
  if printf '%s\n' "$deploy" | grep -q 'imagePullSecrets:'; then
    fail "default image" "renders imagePullSecrets without any being set"
    return
  fi
  ok "default image public, no pull secret"
  deploy=$(only "$(render "$ON --set images.pii_redaction_model.repository=registry.example/pii --set images.pii_redaction_model.tag=1.2.3 --set piiRedactionModel.imagePullSecrets[0].name=lw-registry --set piiRedactionModel.resources.limits.cpu=3")" "pii_redaction_model/deployment")
  if ! printf '%s\n' "$deploy" | grep -q 'image: "registry.example/pii:1.2.3"'; then
    fail "image" "image is not registry.example/pii:1.2.3"
    return
  fi
  if ! printf '%s\n' "$deploy" | grep -A1 'imagePullSecrets:' | grep -q 'name: lw-registry'; then
    fail "pull secret" "lw-registry is not in imagePullSecrets"
    return
  fi
  probes=$(printf '%s\n' "$deploy" | grep -c 'path: /healthz' || true)
  if [ "$probes" != "3" ]; then
    fail "probes" "$probes probes on /healthz, expected 3"
    return
  fi
  if [ "$(printf '%s\n' "$deploy" | awk '/startupProbe:/ { s=1 } s && /failureThreshold:/ { print $2; exit }')" != "36" ]; then
    fail "startup probe" "failureThreshold is not 36 (180 s at 5 s)"
    return
  fi
  if ! printf '%s\n' "$deploy" | grep -q 'terminationGracePeriodSeconds: 80'; then
    fail "grace" "terminationGracePeriodSeconds is not 80"
    return
  fi
  if [ "$(env_value "$deploy" PII_REQUEST_TIMEOUT_SECONDS)" != "45" ]; then
    fail "request deadline" "PII_REQUEST_TIMEOUT_SECONDS is '$(env_value "$deploy" PII_REQUEST_TIMEOUT_SECONDS)', expected 45 (under the app's 50 s)"
    return
  fi
  if printf '%s\n' "$deploy" | grep -q 'name: THREADS'; then
    fail "threads" "THREADS is set; the binary follows the CPU limit itself"
    return
  fi
  ok "image, pull secret, /healthz probes, 180 s startup, 45 s deadline, 80 s grace"
  deploy=$(only "$(render "$ON --set piiRedactionModel.extraEnvs[0].name=PII_MAX_CONCURRENT_REQUESTS --set-string piiRedactionModel.extraEnvs[0].value=2")" "pii_redaction_model/deployment")
  if [ "$(printf '%s\n' "$deploy" | grep -c 'name: PII_MAX_CONCURRENT_REQUESTS$')" != "1" ] || [ "$(env_value "$deploy" PII_MAX_CONCURRENT_REQUESTS)" != "2" ]; then
    fail "extraEnvs override" "PII_MAX_CONCURRENT_REQUESTS is not set once, to 2"
    return
  fi
  ok "extraEnvs replaces a chart setting, once"
  local out rc
  out=$(render "$ON --set piiRedactionModel.extraEnvs[0].name=PORT --set-string piiRedactionModel.extraEnvs[0].value=9090" 2>&1) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ] || ! grep -qF "must not set PORT" <<< "$out"; then
    fail "extraEnvs PORT" "PORT in extraEnvs was not refused"
    return
  fi
  ok "extraEnvs PORT refused"
}

# @scenario "Without an image the chart refuses to render"
test_refuses_without_image() {
  local out rc
  out=$(render "$ON --set images.pii_redaction_model.repository=" 2>&1) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "no image" "helm rendered without an image repository"
  elif ! grep -qF "images.pii_redaction_model.repository" <<< "$out"; then
    fail "no image" "refused, but not naming images.pii_redaction_model"
  else
    ok "no image: refused"
  fi
}

test_default_install_has_no_model
test_every_profile_is_off
test_prod_and_ha_profiles_when_enabled
test_enabled_wires_app_and_workers_only
test_flags_follow_the_toggles
test_external_endpoint
test_external_endpoint_forces_flags
test_image_secrets_probes
test_refuses_without_image

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures PII redaction model check(s) failed"
  exit 1
fi

echo
echo "all PII redaction model checks pass"

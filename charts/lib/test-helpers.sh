#!/usr/bin/env bash
# Shared test helpers for Helm chart E2E tests.
# Source this file from your test script.

set -euo pipefail

# ─── Sanitise environment ────────────────────────────────────────────────────
# Prevent leaked env vars from routing kubectl/helm to a real cluster or
# leaking credentials into test pods.
unset KUBERNETES_SERVICE_HOST KUBERNETES_SERVICE_PORT 2>/dev/null || true
unset KUBECONFIG 2>/dev/null || true
unset DATABASE_URL PGHOST PGUSER PGPASSWORD PGDATABASE 2>/dev/null || true
unset REDIS_URL REDIS_HOST REDIS_PASSWORD 2>/dev/null || true
unset CLICKHOUSE_URL CLICKHOUSE_PASSWORD CLICKHOUSE_CLUSTER 2>/dev/null || true

# ─── Formatting ──────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
pass()  { echo -e "${GREEN}[PASS]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
sep()   { echo -e "\n${CYAN}────────────────────────────────────────────────${NC}"; }

fail() {
  echo -e "${RED}[FAIL]${NC}  $*" >&2
  exit 1
}

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label: expected '$expected', got '$actual'"
  fi
}

# ─── Kind cluster management ────────────────────────────────────────────────

CLUSTER_NAME="${CLUSTER_NAME:-ch-test}"
KUBE_CTX="kind-${CLUSTER_NAME}"

setup_kind() {
  info "Creating Kind cluster: ${CLUSTER_NAME}"
  if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    info "Cluster ${CLUSTER_NAME} already exists, reusing"
  else
    local kind_args=(--name "${CLUSTER_NAME}" --wait 120s)
    if [[ -n "${KIND_CONFIG:-}" ]]; then
      kind_args+=(--config "${KIND_CONFIG}")
    fi
    kind create cluster "${kind_args[@]}"
  fi
  kubectl cluster-info --context "$KUBE_CTX"
}

cleanup_cluster() {
  if [[ "${KEEP_CLUSTER:-false}" == "true" ]]; then
    warn "KEEP_CLUSTER=true — skipping cluster deletion"
    return
  fi
  info "Deleting Kind cluster: ${CLUSTER_NAME}"
  kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
}

# ─── Kubectl / Helm wrappers ────────────────────────────────────────────────

kc() {
  kubectl --context "$KUBE_CTX" -n "${NAMESPACE}" "$@"
}

hc() {
  helm --kube-context "$KUBE_CTX" -n "${NAMESPACE}" "$@"
}

helm_install() {
  # gateway-auth materialisation: the chart's autogen path (enabled in
  # tests/values-e2e*.yaml) now creates langwatch-gateway-auth itself,
  # so we no longer pre-seed it here. Doing so would conflict with the
  # chart-managed Secret on `helm install` ("exists and cannot be
  # imported into the current release"). Only ensure the namespace
  # exists before install — that part used to piggyback on the kubectl
  # create above.
  kubectl --context "$KUBE_CTX" create namespace "${NAMESPACE}" \
    --dry-run=client -o yaml | kubectl --context "$KUBE_CTX" apply -f -

  hc upgrade --install "${RELEASE}" "${CHART_DIR}" \
    --create-namespace \
    --wait --timeout "${TIMEOUT}s" \
    "$@"
}

helm_uninstall() {
  hc uninstall "${RELEASE}" --wait 2>/dev/null || true
  kubectl --context "$KUBE_CTX" delete namespace "${NAMESPACE}" --wait=false 2>/dev/null || true
  # Wait for namespace to be fully gone before next suite
  local attempts=0
  while kubectl --context "$KUBE_CTX" get namespace "${NAMESPACE}" &>/dev/null \
        && [[ $attempts -lt 30 ]]; do
    sleep 2; attempts=$((attempts + 1))
  done
  if kubectl --context "$KUBE_CTX" get namespace "${NAMESPACE}" &>/dev/null; then
    fail "namespace ${NAMESPACE} still exists after 60s — aborting to prevent flakes"
  fi
}

# ─── ClickHouse helpers ─────────────────────────────────────────────────────

ch_query() {
  local pod="$1"; shift
  local query="$1"; shift
  kc exec "$pod" -- \
    sh -c 'clickhouse-client --password "$(cat /mnt/secrets/password)" -q "$0"' "$query" "$@"
}

wait_api() {
  info "Waiting for Kubernetes API server..."
  local attempts=0
  until kubectl --context "$KUBE_CTX" get nodes &>/dev/null; do
    sleep 2; attempts=$((attempts + 1))
    if [[ $attempts -ge 30 ]]; then
      fail "Kubernetes API server not ready after 60s"
    fi
  done
}

wait_ch_ready() {
  local pod="$1"
  local timeout="${2:-${TIMEOUT}}"
  info "Waiting for $pod to be ready (${timeout}s)..."
  kc wait pod "$pod" --for=condition=Ready --timeout="${timeout}s"
  pass "$pod is ready"
}

# Waits until every live pod behind a label selector is Ready.
#
# `kubectl wait pod -l` resolves the selector to pod NAMES once and then watches
# those names, so a pod that disappears while it waits fails the whole call with
# `Error from server (NotFound)`. A rolling update deletes the outgoing pods at
# exactly that moment, and nothing upstream of this helper rules it out: both
# `helm --wait` and a Deployment's ready check are satisfied by the new replicas
# alone, while the previous ones are still terminating or not yet even deleted.
#
# So the pod set is settled before a single name is taken. Every workload behind
# the selector is rolled out first, and a rollout only completes once the
# outgoing pods have left the active count, which means every deletion the
# controller intends has already been issued. Names are then taken only from
# pods that carry no deletion timestamp. Together those two mean nothing handed
# to `kubectl wait` is on its way out, and nothing new is about to go.
#
# Deployments are reached through their ReplicaSets rather than by their own
# labels: a workload's labels need not match the ones it stamps on its pods, but
# the Deployment controller copies the pod template's labels onto every
# ReplicaSet it creates and records the Deployment in ownerReferences. A
# selector that matches no workload at all (a bare pod) simply skips the
# rollout wait, which is correct: nothing rolls it.
wait_pod_ready() {
  local selector="$1"
  local timeout="${2:-${TIMEOUT}}"
  info "Waiting for pods with label $selector (${timeout}s)..."

  local targets target
  targets=$( {
    kc get statefulset,daemonset -l "$selector" -o name
    kc get replicaset -l "$selector" \
      -o go-template='{{range .items}}{{range .metadata.ownerReferences}}{{if eq .kind "Deployment"}}deployment/{{.name}}{{"\n"}}{{end}}{{end}}{{end}}'
  } | sort -u )
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    kc rollout status "$target" --timeout="${timeout}s"
  done <<< "$targets"

  local live pod
  local pods=()
  live=$(kc get pod -l "$selector" \
    -o go-template='{{range .items}}{{if not .metadata.deletionTimestamp}}{{.metadata.name}}{{"\n"}}{{end}}{{end}}')
  while IFS= read -r pod; do
    [[ -n "$pod" ]] || continue
    pods+=("$pod")
  done <<< "$live"
  [[ ${#pods[@]} -gt 0 ]] || fail "no live pods match $selector"

  kc wait pod "${pods[@]}" --for=condition=Ready --timeout="${timeout}s"
}

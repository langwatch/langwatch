#!/usr/bin/env bash
# Shared test helpers for Helm chart E2E tests.
# Source this file from your test script.

set -euo pipefail

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
    kind create cluster --name "${CLUSTER_NAME}" --wait 120s
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
}

# ─── ClickHouse helpers ─────────────────────────────────────────────────────

ch_query() {
  local pod="$1"; shift
  local query="$1"; shift
  kc exec "$pod" -- \
    sh -c 'clickhouse-client --password "$(cat /mnt/secrets/password)" -q "$0"' "$query" "$@"
}

wait_ch_ready() {
  local pod="$1"
  local timeout="${2:-${TIMEOUT}}"
  info "Waiting for $pod to be ready (${timeout}s)..."
  kc wait pod "$pod" --for=condition=Ready --timeout="${timeout}s"
  pass "$pod is ready"
}

wait_pod_ready() {
  local selector="$1"
  local timeout="${2:-${TIMEOUT}}"
  info "Waiting for pods with label $selector (${timeout}s)..."
  kc wait pod -l "$selector" --for=condition=Ready --timeout="${timeout}s"
}

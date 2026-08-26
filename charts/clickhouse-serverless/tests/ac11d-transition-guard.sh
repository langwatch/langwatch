#!/usr/bin/env bash
# AC11-D — the chart blocks the unsupported replicas:1 -> replicas:3 transition.
#
# Plan authority: /tmp/1168-draft3-comment.md line 134. The AC is falsifiable by
# command, which is why it was chosen over a docs branch:
#
#   (a) `helm upgrade --set replicas=3` against a release installed at
#       replicas:1 MUST exit non-zero with stderr containing the literal string
#       "unsupported transition";
#   (b) the same command against a release already at replicas:3 MUST exit 0,
#       so the guard does not block legitimate upgrades.
#
# This script additionally captures (c): a FRESH install at replicas:3 on an
# empty namespace MUST exit 0, because a lookup-based guard that fired on
# install would break every first install.
#
# Exit codes: 0 all three cases behaved as required; 1 at least one did not;
# 10 harness/environment problem (the cases were never measured).
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-ch-ac11d}"
NAMESPACE="${NAMESPACE:-ch-ac11d}"
RELEASE="${RELEASE:-ch}"
IMAGE_REPO="${IMAGE_REPO:-langwatch/clickhouse-serverless}"
TAG="${TAG:-0.3.0}"
KEEP_CLUSTER="${KEEP_CLUSTER:-false}"
TIMEOUT="${TIMEOUT:-600}"

CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VALUES="${CHART_DIR}/tests/values-ac11d.yaml"
KUBE_CTX="kind-${CLUSTER_NAME}"
RUN_DIR="$(mktemp -d /tmp/ac11d-XXXXXX)"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
info() { echo -e "${CYAN}[INFO]${NC}  $(ts) $*"; }
pass() { echo -e "${GREEN}[PASS]${NC}  $*"; }
# shellcheck disable=SC2317  # reached via the EXIT trap
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
FAILURES=0
fail() { echo -e "${RED}[FAIL]${NC}  $*" >&2; FAILURES=$((FAILURES + 1)); }
harness_error() { echo -e "${RED}[HARNESS-ERROR]${NC} $*" >&2; exit 10; }

kc() { env -u KUBECONFIG kubectl --context "$KUBE_CTX" -n "$NAMESPACE" "$@"; }
hc() { env -u KUBECONFIG helm --kube-context "$KUBE_CTX" -n "$NAMESPACE" "$@"; }

# `kind load docker-image` is broken where the docker containerd store holds
# only the native child of a multi-platform list: it shells out with
# --all-platforms and dies on the missing sibling digest. Saving the one
# platform we need and loading the archive is the path that works.
load_image() {
  local ref="$1"
  local platform archive
  archive="${RUN_DIR}/$(echo "$ref" | tr '/:' '__').tar"
  platform="linux/$(docker version --format '{{.Server.Arch}}' 2>/dev/null || echo amd64)"
  docker image inspect "$ref" >/dev/null 2>&1 || docker pull --platform "$platform" "$ref" >/dev/null 2>&1 \
    || harness_error "could not obtain ${ref} for ${platform}"
  docker save --platform "$platform" -o "$archive" "$ref" \
    || harness_error "docker save failed for ${ref}"
  kind load image-archive "$archive" --name "$CLUSTER_NAME" >/dev/null \
    || harness_error "kind load image-archive failed for ${ref}"
  info "side-loaded ${ref} (${platform})"
}

# Every case is recorded with its exact command, exit code and full stderr, so a
# verdict can be checked against evidence rather than taken on trust.
run_case() {
  local name="$1" expect="$2"; shift 2
  local out rc=0
  info "── case ${name}: \$ $*"
  out="$("$@" 2>&1)" || rc=$?
  printf '%s\n' "$out" > "${RUN_DIR}/${name}.out"
  echo "    exit=${rc}"
  printf '%s\n' "$out" | sed 's/^/    | /'
  CASE_OUT="$out"
  case "$expect" in
    zero)     [[ "$rc" -eq 0 ]] || fail "${name}: expected exit 0, got ${rc}" ;;
    non-zero) [[ "$rc" -ne 0 ]] || fail "${name}: expected a non-zero exit, got 0 — the guard did not fire" ;;
  esac
}

purge() {
  hc uninstall "$RELEASE" --wait --timeout "${TIMEOUT}s" >/dev/null 2>&1 || true
  kc delete pvc --all --ignore-not-found >/dev/null 2>&1 || true
  # helm.sh/resource-policy=keep leaves the credentials Secret behind; a stale
  # one would carry a clusterSecret from the previous topology into the next
  # case and make the next install a different experiment than it claims to be.
  kc delete secret "${RELEASE}-clickhouse" --ignore-not-found >/dev/null 2>&1 || true
  kc delete sts --all --ignore-not-found >/dev/null 2>&1 || true
}

# shellcheck disable=SC2317  # reached via the EXIT trap, not by fallthrough
cleanup() {
  if [[ "$KEEP_CLUSTER" == "true" ]]; then
    warn "KEEP_CLUSTER=true — leaving cluster ${CLUSTER_NAME} up"
  else
    kind delete cluster --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
  fi
  info "evidence: ${RUN_DIR}"
}
trap cleanup EXIT

command -v kind >/dev/null || harness_error "kind not found"
command -v helm >/dev/null || harness_error "helm not found"
command -v docker >/dev/null || harness_error "docker not found"

info "AC11-D transition guard — cluster=${CLUSTER_NAME} tag=${TAG}"
kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME" \
  || kind create cluster --name "$CLUSTER_NAME" --wait 120s >/dev/null \
  || harness_error "kind create cluster failed"
load_image "${IMAGE_REPO}:${TAG}"
kc get ns "$NAMESPACE" >/dev/null 2>&1 \
  || env -u KUBECONFIG kubectl --context "$KUBE_CTX" create namespace "$NAMESPACE" >/dev/null

# ── (c) fresh install at replicas:3 must NOT be blocked ──────────────────────
purge
run_case "c-fresh-install-replicas3" zero \
  hc install "$RELEASE" "$CHART_DIR" -f "$VALUES" --set replicas=3 --wait --timeout "${TIMEOUT}s"

# ── (b) 3 -> 3 upgrade must NOT be blocked ───────────────────────────────────
run_case "b-upgrade-3-to-3" zero \
  hc upgrade "$RELEASE" "$CHART_DIR" -f "$VALUES" --set replicas=3 --wait --timeout "${TIMEOUT}s"

# ── (a) 1 -> 3 upgrade MUST be blocked, naming the transition ────────────────
purge
run_case "a-install-replicas1" zero \
  hc install "$RELEASE" "$CHART_DIR" -f "$VALUES" --set replicas=1 --wait --timeout "${TIMEOUT}s"

run_case "a-upgrade-1-to-3" non-zero \
  hc upgrade "$RELEASE" "$CHART_DIR" -f "$VALUES" --set replicas=3 --wait --timeout "${TIMEOUT}s"
# The exit code alone is not evidence: a timeout, an image pull failure or a
# quota rejection would also be non-zero. The AC names the string for exactly
# this reason, so assert on it.
if [[ "$CASE_OUT" == *"unsupported transition"* ]]; then
  pass "AC11-D(a) the 1 -> 3 upgrade was refused, stderr names 'unsupported transition'"
else
  fail "AC11-D(a) the upgrade exited non-zero but stderr does NOT contain 'unsupported transition' — a non-zero exit for some other reason is not evidence the guard fired"
fi

# The blocked upgrade must also be a no-op: a guard that fails AFTER mutating
# the StatefulSet would leave the release in the state it just refused to create.
STS_AFTER="$(kc get sts "${RELEASE}-clickhouse" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "<none>")"
info "StatefulSet spec.replicas after the refused upgrade: ${STS_AFTER}"
if [[ "$STS_AFTER" == "1" ]]; then
  pass "AC11-D(a) the refused upgrade left the release at replicas=1"
else
  fail "AC11-D(a) the refused upgrade left spec.replicas='${STS_AFTER}', expected '1' — the guard fired after mutating the cluster"
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
  pass "AC11-D: all three cases behaved as the AC requires"
  exit 0
fi
echo -e "${RED}[SUMMARY]${NC} ${FAILURES} case(s) did not behave as required" >&2
exit 1

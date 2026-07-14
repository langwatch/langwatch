#!/usr/bin/env bash
# helm-safe.sh — thin wrapper that forces a local kubectl context.
#
# Usage:
#   ./examples/helm-safe.sh install lw . -f examples/values-local.yaml
#
# Auto-reads namespace from values file header (# namespace: xxx).
# Override context: KUBE_CONTEXT=minikube ./examples/helm-safe.sh ...
set -euo pipefail

KUBE_CONTEXT="${KUBE_CONTEXT:-kind-lw-local}"

# Extract namespace from values file header (looks for "# namespace: xxx")
namespace=""
for arg in "$@"; do
  if [[ -f "$arg" && "$arg" == *values*.yaml ]]; then
    ns=$(grep -m1 '^# namespace:' "$arg" 2>/dev/null | sed 's/^# namespace: *//' || true)
    if [[ -n "$ns" ]]; then
      namespace="$ns"
    fi
  fi
done

echo "[helm-safe] context: ${KUBE_CONTEXT}${namespace:+, namespace: ${namespace}}"

subcmd="$1"; shift
exec helm "$subcmd" --kube-context "${KUBE_CONTEXT}" \
  ${namespace:+--namespace "${namespace}" --create-namespace} \
  "$@"

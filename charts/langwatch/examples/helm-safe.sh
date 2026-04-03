#!/usr/bin/env bash
# helm-safe.sh — forces a local kubectl context and reads namespace from values file.
#
# Usage:
#   ./examples/helm-safe.sh install lw -f examples/values-dev.yaml
#
# It auto-adds: --kube-context, --namespace, --create-namespace
# from the values file's `# namespace: xxx` header comment.
#
# Override:
#   KUBE_CONTEXT=kind-langwatch ./examples/helm-safe.sh install ...
set -euo pipefail

KUBE_CONTEXT="${KUBE_CONTEXT:-minikube}"

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
exec helm --kube-context "${KUBE_CONTEXT}" \
  ${namespace:+--namespace "${namespace}" --create-namespace} \
  "$@"

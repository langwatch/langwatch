#!/usr/bin/env bash
# Asserts no rendered object repeats a mapping key, such as a label written by
# hand beside include "langwatch.labels". Helm keeps the last value silently,
# so only a strict YAML parse of the render shows it. Run from charts/langwatch
# after helm dependency build .
set -euo pipefail
cd "$(dirname "$0")/.."

if ! python3 -c "import yaml" 2>/dev/null; then
  python3 -m pip install --quiet --user --break-system-packages pyyaml 2>/dev/null ||
    python3 -m pip install --quiet --user pyyaml
fi

# The example presets that render standalone; the clickhouse-external and
# clickhouse-replicated ones need a cluster-specific overlay to render.
readonly VALUES_FILES=(
  examples/values-test.yaml
  examples/values-local.yaml
  examples/values-hosted-dev.yaml
  examples/values-hosted-prod.yaml
  examples/values-scalable-prod.yaml
)

# Every PDB and a cronjob on, so each labelled template renders. Only the
# multi-replica presets take it: local-filesystem storage requires one replica.
readonly ALL_ON_VALUES_FILES=(
  examples/values-hosted-prod.yaml
  examples/values-scalable-prod.yaml
)
readonly ALL_ON_SETS=(
  --set autogen.enabled=true
  --set app.replicaCount=3 --set app.podDisruptionBudget.maxUnavailable=1
  --set app.podDisruptionBudget.minAvailable=null
  --set workers.replicaCount=3 --set workers.podDisruptionBudget.maxUnavailable=1
  --set workers.podDisruptionBudget.minAvailable=null
  --set langwatch_nlp.replicaCount=3 --set langwatch_nlp.podDisruptionBudget.maxUnavailable=1
  --set langwatch_nlp.podDisruptionBudget.minAvailable=null
  --set langevals.replicaCount=3 --set langevals.podDisruptionBudget.maxUnavailable=1
  --set langevals.podDisruptionBudget.minAvailable=null
  --set cronjobs.enabled=true
  --set cronjobs.jobs.labelcheck.enabled=true
  --set cronjobs.jobs.labelcheck.schedule="0 * * * *"
  --set cronjobs.jobs.labelcheck.endpoint=/api/cron/labelcheck
)

readonly STRICT_PARSE='
import sys, yaml

class StrictLoader(yaml.SafeLoader):
    pass

def construct_mapping(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise yaml.constructor.ConstructorError(
                None, None, "duplicate key %r" % (key,), key_node.start_mark)
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)

StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_mapping)

source = sys.stdin.read()
duplicates = 0
for doc in source.split("\n---"):
    try:
        list(yaml.load_all(doc, Loader=StrictLoader))
    except yaml.constructor.ConstructorError as error:
        name = next((l for l in doc.splitlines() if l.startswith("# Source:")), "?")
        print("  %s: %s" % (name, error.problem), file=sys.stderr)
        duplicates += 1
sys.exit(1 if duplicates else 0)
'

failures=0
# check_render <label> <helm template args...>
check_render() {
  local label=$1 rendered
  shift
  if ! rendered=$(helm template lw . "$@" 2>&1); then
    echo "FAIL [$label] does not render:"
    echo "$rendered"
    failures=$((failures + 1))
    return
  fi
  if printf '%s' "$rendered" | python3 -c "$STRICT_PARSE"; then
    echo "ok   [$label] no duplicate keys"
  else
    echo "FAIL [$label] rendered objects repeat a key"
    failures=$((failures + 1))
  fi
}

for values in "${VALUES_FILES[@]}"; do
  check_render "$values" -f "$values"
done
for values in "${ALL_ON_VALUES_FILES[@]}"; do
  check_render "$values + every PDB and a cronjob" -f "$values" "${ALL_ON_SETS[@]}"
done

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures render(s) failed the duplicate-key check"
  exit 1
fi
echo
echo "all rendered objects have unique keys"

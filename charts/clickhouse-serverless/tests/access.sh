#!/usr/bin/env bash
# Asserts the access sidecar wiring (ADR-184). Pure `helm template` and grep,
# no cluster required.
set -euo pipefail

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CHART_DIR"

fail() { echo "FAIL: $*" >&2; exit 1; }

statefulset() {
  helm template t . --show-only templates/statefulset.yaml "$@"
}

# @scenario "The chart runs no access sidecar unless asked"
test_access_off_by_default() {
  local out
  out="$(statefulset --set autogen.enabled=true)"
  [ "$(sed -n '/^      containers:/,/^      volumes:/p' <<<"$out" | grep -c '^        - name: ')" = "1" ] \
    || fail "default pod should run one container"
  ! grep -q 'CLICKHOUSE_ACCESS_FILE' <<<"$out" || fail "default pod should have no access file"
  ! grep -q 'access-config' <<<"$out" || fail "default pod should mount no access config"
  ! helm template t . --set autogen.enabled=true | grep -q 'kind: ConfigMap' \
    || fail "default install should render no access ConfigMap"
  echo "PASS: access is off by default"
}

# @scenario "With access enabled the chart wires the sidecar, the access file and the password Secrets"
test_access_enabled_wires_sidecar() {
  local out sidecar
  out="$(statefulset -f tests/values-access.yaml)"
  grep -q '^        - name: access$' <<<"$out" || fail "the access sidecar container is missing"
  sidecar="$(sed -n '/^        - name: access$/,/^      volumes:/p' <<<"$out")"
  grep -q 'command: \["ch-config", "sidecar", "/etc/clickhouse-server"\]' <<<"$sidecar" || fail "sidecar runs the wrong command"
  grep -q 'mountPath: /etc/clickhouse-server/users.d' <<<"$sidecar" || fail "sidecar must share users.d"
  grep -q 'value: "127.0.0.1:8124"' <<<"$sidecar" || fail "sidecar must listen on loopback"
  ! grep -q '/mnt/secrets' <<<"$sidecar" || fail "sidecar must not see the default password"
  for where in "$sidecar" "$(sed -n '/^        - name: clickhouse$/,/^        - name: access$/p' <<<"$out")"; do
    grep -q 'mountPath: /etc/clickhouse-access/config' <<<"$where" || fail "access file not mounted in both containers"
    grep -q 'mountPath: /etc/clickhouse-access/secrets/metabase-passwords' <<<"$where" || fail "password Secret not mounted in both containers"
  done
  grep -A1 'name: CLICKHOUSE_ACCESS_SIDECAR' <<<"$out" | grep -q 'value: external' \
    || fail "ClickHouse must not also run an embedded sidecar"
  grep -q 'secretName: metabase-passwords' <<<"$out" || fail "password Secret volume missing"
  helm template t . -f tests/values-access.yaml --show-only templates/access-configmap.yaml \
    | grep -q 'subject: system:serviceaccount:monitoring:grafana' || fail "access.yaml not rendered into the ConfigMap"
  echo "PASS: access enabled wires the sidecar"
}

test_access_needs_a_file() {
  if helm template t . --set autogen.enabled=true --set access.enabled=true >/dev/null 2>&1; then
    fail "access.enabled without a file should fail to render"
  fi
  echo "PASS: access.enabled without a file is refused"
}

echo "--- access sidecar assertions ---"
test_access_off_by_default
test_access_enabled_wires_sidecar
test_access_needs_a_file

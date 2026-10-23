#!/usr/bin/env bash
# Asserts the backup modes and the sidecar wiring (ADR-191). Pure `helm
# template` and grep, no cluster required.
set -euo pipefail

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CHART_DIR"

fail() { echo "FAIL: $*" >&2; exit 1; }
BASE=(--set autogen.enabled=true --set backup.enabled=true --set objectStorage.bucket=b --set objectStorage.region=r)

kinds() { grep -E '^kind: |^  name: ' | paste - - | sed 's/kind: //; s/  name: //'; }
containers() { sed -n '/^      containers:/,/^      volumes:/p' | grep '^        - name: ' | sed 's/.*- name: //'; }

# @scenario "The chart keeps CronJob mode as the default"
test_cronjob_default() {
  local out
  out="$(helm template t . "${BASE[@]}")"
  grep -q 'name: t-clickhouse-backup-full$' <<<"$out" || fail "default mode lost the full CronJob"
  grep -q 'name: t-clickhouse-backup-incremental$' <<<"$out" || fail "default mode lost the incremental CronJob"
  [ "$(containers <<<"$(helm template t . "${BASE[@]}" --show-only templates/statefulset.yaml)")" = "clickhouse" ] \
    || fail "default mode should run no sidecar"
  ! grep -q 'BACKUP_SIDECAR' <<<"$out" || fail "default mode should not configure the sidecar"
  ! grep -q 'kind: PodMonitor' <<<"$out" || fail "default mode should render no PodMonitor"
  echo "PASS: CronJob mode is the default and unchanged"
}

# @scenario "In sidecar mode the chart runs no backup CronJobs and wires the sidecar"
test_sidecar_mode() {
  local out sts sidecar
  out="$(helm template t . -f tests/values-backup-sidecar.yaml)"
  ! grep -q 'name: t-clickhouse-backup-full$' <<<"$out" || fail "sidecar mode still renders the full CronJob"
  ! grep -q 'name: t-clickhouse-backup-incremental$' <<<"$out" || fail "sidecar mode still renders the incremental CronJob"
  grep -q 'name: t-clickhouse-restore-template$' <<<"$out" || fail "the restore template should render in every mode"
  sts="$(helm template t . -f tests/values-backup-sidecar.yaml --show-only templates/statefulset.yaml)"
  [ "$(containers <<<"$sts" | tr '\n' ' ')" = "clickhouse backup " ] || fail "want the clickhouse and backup containers"
  sidecar="$(sed -n '/^        - name: backup$/,/^      volumes:/p' <<<"$sts")"
  for want in 'value: run' 'value: "backup_runner"' 'value: /etc/clickhouse-backup/credentials/password' \
    'value: "0 5 \*/3 \* \*"' 'value: "30 \* \* \* \*"' 'value: "104857600"' 'name: BACKUP_CLUSTER' \
    'value: "0.0.0.0:8125"' 'name: backup-metrics' 'containerPort: 8125'; do
    grep -q -- "$want" <<<"$sidecar" || fail "sidecar lacks $want"
  done
  grep -A1 'name: BACKUP_RUNNER_ORDINAL' <<<"$sidecar" | grep -q 'value: "1"' || fail "runner ordinal not passed"
  ! grep -q 'readinessProbe' <<<"$sidecar" || fail "a backup sidecar must not gate pod readiness"
  ! grep -q 'CLICKHOUSE_PASSWORD' <<<"$sidecar" || fail "the sidecar must not take a password from env"
  ! grep -q '/mnt/secrets' <<<"$sidecar" || fail "the sidecar must not see the server's secrets mount"
  grep -A6 'name: backup-credentials$' <<<"$(sed -n '/^      volumes:/,$p' <<<"$sts")" | grep -q 'secretName: clickhouse-backup-login' \
    || fail "backup.passwordSecret not mounted"
  ! grep -q 'BACKUP_SIDECAR' <<<"$(sed -n '/^        - name: clickhouse$/,/^        - name: backup$/p' <<<"$sts")" \
    || fail "the server container must not also run an embedded backup sidecar"
  grep -q 'kind: PodMonitor' <<<"$out" || fail "PodMonitor not rendered"
  if helm template t . "${BASE[@]}" --set backup.mode=lambda >/dev/null 2>&1; then
    fail "an unknown backup.mode should be refused"
  fi
  echo "PASS: sidecar mode wires the sidecar and drops the backup CronJobs"
}

# @scenario "Observe mode keeps the CronJobs and runs the sidecar beside them"
test_observe_mode() {
  local out sts
  out="$(helm template t . "${BASE[@]}" --set backup.mode=cronjob-observe --set access.enabled=true --set-json 'access.config={"users":[]}')"
  grep -q 'name: t-clickhouse-backup-full$' <<<"$out" || fail "observe mode must keep the CronJobs"
  sts="$(helm template t . "${BASE[@]}" --set backup.mode=cronjob-observe --set access.enabled=true --set-json 'access.config={"users":[]}' --show-only templates/statefulset.yaml)"
  [ "$(containers <<<"$sts" | tr '\n' ' ')" = "clickhouse access " ] || fail "with access on, backups share the access container"
  grep -A1 'name: BACKUP_SIDECAR' <<<"$sts" | grep -q 'value: observe' || fail "observe mode should set BACKUP_SIDECAR=observe"
  grep -q 'CLICKHOUSE_ACCESS_FILE' <<<"$(sed -n '/^        - name: access$/,/^      volumes:/p' <<<"$sts")" || fail "access lost its file"
  echo "PASS: observe mode keeps the CronJobs beside an observing sidecar"
}

# @scenario "Sidecar-mode alerts read the runner's own metrics"
test_sidecar_alerts() {
  local out observe
  out="$(helm template t . -f tests/values-backup-sidecar.yaml --namespace clickhouse --show-only templates/backup-alerts.yaml)"
  [ "$(grep -c 'alert: ClickHouseBackupStale' <<<"$out")" = "2" ] || fail "want a stale alert per mode"
  [ "$(grep -c 'alert: ClickHouseBackupFailing' <<<"$out")" = "2" ] || fail "want a failure alert per mode"
  for want in 'alert: ClickHouseBackupNoRunner' 'alert: ClickHouseBackupMultipleRunners' 'alert: ClickHouseBackupConfigError' \
    'absent(clickhouse_backup_runner{namespace="clickhouse", pod=~"t-clickhouse-[0-9]+"})' \
    'clickhouse_backup_sidecar_start_timestamp_seconds' 'mode="incremental"' '> 10800' '> 93600'; do
    grep -qF -- "$want" <<<"$out" || fail "sidecar alerts lack $want"
  done
  ! grep -q 'kube_cronjob' <<<"$out" || fail "sidecar mode should render no CronJob rules"
  observe="$(helm template t . -f tests/values-backup-sidecar.yaml --set backup.mode=cronjob-observe --namespace clickhouse --show-only templates/backup-alerts.yaml)"
  grep -q 'kube_cronjob_status_last_successful_time' <<<"$observe" || fail "observe mode should keep the CronJob rules"
  grep -q 'clickhouse_backup_runner' <<<"$observe" || fail "observe mode should add the sidecar rules"
  echo "PASS: sidecar alerts read the sidecar's metrics"
}

# @scenario "Dynamic-only mode refuses backup CronJobs and runs sidecar backups as the local admin"
test_dynamic_only() {
  local sts sidecar out
  for mode in cronjob cronjob-observe; do
    if helm template t . -f tests/values-dynamic-only.yaml "${BASE[@]}" --set backup.mode=$mode >/dev/null 2>&1; then
      fail "dynamic-only should refuse backup.mode=$mode: its CronJobs cannot log in"
    fi
  done
  out="$(helm template t . -f tests/values-dynamic-only.yaml "${BASE[@]}" --set backup.mode=sidecar)"
  ! grep -q 'name: t-clickhouse-backup-\(full\|incremental\)$\|name: t-clickhouse-restore-template$' <<<"$out" \
    || fail "dynamic-only sidecar mode should render no CronJob, restore template included"
  sts="$(helm template t . -f tests/values-dynamic-only.yaml "${BASE[@]}" --set backup.mode=sidecar --show-only templates/statefulset.yaml)"
  sidecar="$(sed -n '/^        - name: access$/,/^      volumes:/p' <<<"$sts")"
  grep -A1 'name: BACKUP_SIDECAR' <<<"$sidecar" | grep -q 'value: run' || fail "the access container should run backups"
  grep -q 'name: CLICKHOUSE_ACCESS_BOOTSTRAP_DIR' <<<"$sidecar" || fail "the runner needs the local admin's directory"
  grep -q 'mountPath: /run/clickhouse-access' <<<"$sidecar" || fail "the local admin's directory is not mounted"
  ! grep -q 'BACKUP_PASSWORD_FILE\|backup-credentials' <<<"$sts" || fail "dynamic-only mounts no static backup password"
  echo "PASS: dynamic-only refuses CronJobs and backs up from the sidecar"
}

echo "--- backup sidecar assertions ---"
test_cronjob_default
test_sidecar_mode
test_observe_mode
test_sidecar_alerts
test_dynamic_only

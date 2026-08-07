#!/usr/bin/env bash
# Asserts the properties of the rendered backup alerting rules that a
# well-meaning simplification would quietly remove. Pure `helm template`, no
# cluster required.
set -euo pipefail

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CHART_DIR"

RELEASE="alert-test"
RENDERED="$(helm template "$RELEASE" . -f tests/values-backup-alerts.yaml \
  --namespace clickhouse --show-only templates/backup-alerts.yaml)"

fail() { echo "FAIL: $*" >&2; exit 1; }

assert_contains() {
  local needle="$1" what="$2"
  grep -qF -- "$needle" <<<"$RENDERED" || fail "$what (missing: $needle)"
}

assert_count() {
  local needle="$1" want="$2" what="$3" got
  got="$(grep -cF -- "$needle" <<<"$RENDERED" || true)"
  [ "$got" = "$want" ] || fail "$what (expected $want occurrences of '$needle', got $got)"
}

echo "--- backup alerting rule assertions ---"

# Three targets x four alerts.
assert_count "- alert: " 12 "each target should render four alerts"
assert_count "alert: ClickHouseBackupStale" 3 "every target needs a freshness alert"
assert_count "alert: ClickHouseBackupJobFailed" 3 "every target needs a failure alert"
assert_count "alert: ClickHouseBackupCronJobSuspended" 3 "every target needs a suspension alert"
assert_count "alert: ClickHouseBackupCronJobMissing" 3 "every target needs an absent-metrics alert"

# The freshness alert must keep its second branch. Without it a CronJob that has
# never once succeeded has no kube_cronjob_status_last_successful_time series,
# the subtraction yields an empty vector, and the backup is silently unwatched
# for as long as it stays broken.
assert_contains "kube_cronjob_created{" "freshness alert lost its never-succeeded branch"
assert_count "unless" 3 "freshness alert lost its never-succeeded branch"

# The failure alert must stay scoped to recently created Jobs. Failed Job
# objects are retained until a newer failure evicts them, so an unscoped version
# fires forever on a months-old failure and gets muted.
assert_contains "kube_job_created{" "failure alert is not scoped to recent Jobs"

# Reads the Job's Failed condition, not the failed-pod counter, which is
# non-zero for a Job that succeeded on retry.
assert_contains 'kube_job_failed{namespace="clickhouse", condition="true"}' \
  "failure alert should read the Job Failed condition"

# A `cronjob` target is a suffix, so the release fullname is prepended.
assert_contains 'cronjob="alert-test-clickhouse-backup-full"' "full backup target not wired to its CronJob"
assert_contains 'cronjob="alert-test-clickhouse-backup-incremental"' "incremental target not wired to its CronJob"

# A `cronjobName` target is exact, so a CronJob this chart does not create can
# still be watched. Prefixing it would silently select a CronJob that does not
# exist, and ClickHouseBackupCronJobMissing would then fire forever.
assert_contains 'cronjob="acme-ebs-snapshotter"' "externally managed target should be matched by exact name"
if grep -qF 'alert-test-clickhouse-acme-ebs-snapshotter' <<<"$RENDERED"; then
  fail "cronjobName target should not have the release fullname prepended"
fi

# Thresholds come from staleAfterHours: 26h and 3h.
assert_contains "> 93600" "full backup should go stale after 26h"
assert_contains "> 10800" "incremental backup should go stale after 3h"

# Every alert carries a runbook and the configured routing labels.
assert_count "runbook_url:" 12 "every alert needs a runbook_url"
assert_count "route: page" 12 "additionalLabels should reach every alert"

# The PrometheusRule output mode carries the same rules, just a different kind.
PROM_RULE="$(helm template "$RELEASE" . -f tests/values-backup-alerts.yaml \
  --namespace clickhouse --set backup.monitoring.prometheusRule.enabled=true \
  --show-only templates/backup-alerts.yaml)"
grep -qF "kind: PrometheusRule" <<<"$PROM_RULE" || fail "prometheusRule mode did not render a PrometheusRule"
if grep -qF "kind: ConfigMap" <<<"$PROM_RULE"; then
  fail "prometheusRule mode should not also render a ConfigMap"
fi
[ "$(grep -cF -- "- alert: " <<<"$PROM_RULE")" = "12" ] || fail "prometheusRule mode lost alerts"

# Mutually exclusive naming: setting both, or neither, is a render-time error.
for bad in \
  "--set backup.monitoring.targets[0].cronjobName=x" \
  "--set-string backup.monitoring.targets[0].cronjob= --set backup.monitoring.targets[0].cronjobName=" ; do
  # shellcheck disable=SC2086
  if helm template "$RELEASE" . -f tests/values-backup-alerts.yaml $bad >/dev/null 2>&1; then
    fail "target naming should be rejected ($bad)"
  fi
done

# Off by default, and off whenever backups themselves are off. Rendering the
# whole chart rather than --show-only, so this asserts on the manifests that
# come out instead of on how helm happens to report an empty selection.
for args in \
  "--set backup.enabled=true --set backup.monitoring.enabled=false" \
  "--set backup.enabled=false --set backup.monitoring.enabled=true" ; do
  # shellcheck disable=SC2086
  disabled="$(helm template "$RELEASE" . -f tests/values-backup-alerts.yaml $args)"
  if grep -qF "$RELEASE-clickhouse-backup-alerts" <<<"$disabled"; then
    fail "backup alerts rendered when they should not have ($args)"
  fi
  if grep -qF "alert: ClickHouseBackup" <<<"$disabled"; then
    fail "backup alert rules leaked into another manifest ($args)"
  fi
done

echo "OK"

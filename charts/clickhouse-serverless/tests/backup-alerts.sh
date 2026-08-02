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

# Two targets x four alerts.
assert_count "- alert: " 8 "each target should render four alerts"
assert_count "alert: ClickHouseBackupStale" 2 "every target needs a freshness alert"
assert_count "alert: ClickHouseBackupJobFailed" 2 "every target needs a failure alert"
assert_count "alert: ClickHouseBackupCronJobSuspended" 2 "every target needs a suspension alert"
assert_count "alert: ClickHouseBackupCronJobMissing" 2 "every target needs an absent-metrics alert"

# The freshness alert must keep its second branch. Without it a CronJob that has
# never once succeeded has no kube_cronjob_status_last_successful_time series,
# the subtraction yields an empty vector, and the backup is silently unwatched
# for as long as it stays broken.
assert_contains "kube_cronjob_created{" "freshness alert lost its never-succeeded branch"
assert_count "unless" 2 "freshness alert lost its never-succeeded branch"

# The failure alert must stay scoped to recently created Jobs. Failed Job
# objects are retained until a newer failure evicts them, so an unscoped version
# fires forever on a months-old failure and gets muted.
assert_contains "kube_job_created{" "failure alert is not scoped to recent Jobs"

# Reads the Job's Failed condition, not the failed-pod counter, which is
# non-zero for a Job that succeeded on retry.
assert_contains 'kube_job_failed{namespace="clickhouse", condition="true"}' \
  "failure alert should read the Job Failed condition"

# Names are built from the release fullname, so they track the CronJobs.
assert_contains 'cronjob="alert-test-clickhouse-backup-full"' "full backup target not wired to its CronJob"
assert_contains 'cronjob="alert-test-clickhouse-backup-incremental"' "incremental target not wired to its CronJob"

# Thresholds come from staleAfterHours: 26h and 3h.
assert_contains "> 93600" "full backup should go stale after 26h"
assert_contains "> 10800" "incremental backup should go stale after 3h"

# Every alert carries a runbook and the configured routing labels.
assert_count "runbook_url:" 8 "every alert needs a runbook_url"
assert_count "route: page" 8 "additionalLabels should reach every alert"

# Off by default, and off whenever backups themselves are off.
for args in \
  "--set backup.enabled=true --set backup.monitoring.enabled=false" \
  "--set backup.enabled=false --set backup.monitoring.enabled=true" ; do
  # shellcheck disable=SC2086
  if helm template "$RELEASE" . -f tests/values-backup-alerts.yaml $args \
      --show-only templates/backup-alerts.yaml >/dev/null 2>&1; then
    fail "backup alerts rendered when they should not have ($args)"
  fi
done

echo "OK"

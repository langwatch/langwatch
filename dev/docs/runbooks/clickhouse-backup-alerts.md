# ClickHouse backup alerts

> **Why this exists**: the `clickhouse-serverless` chart takes backups on a
> schedule, and for a long time nothing watched whether they worked. A cross
> region sync job failed on every single run for 29 consecutive days and was
> found by accident during unrelated work. These alerts exist so that the state
> "backups are not happening" cannot be quiet. This page is what the
> `runbook_url` annotation on each of them points at.

Enable with `backup.monitoring.enabled=true` (see the chart README for the full
value list). The rules read kube-state-metrics only, so the one prerequisite is
a Prometheus that scrapes it.

## The four alerts

| Alert                              | Severity | Means                                                                        |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `ClickHouseBackupStale`            | critical | No successful run inside the backup's window, or no successful run ever      |
| `ClickHouseBackupJobFailed`        | warning  | A Job created inside the window ended with a `Failed` condition              |
| `ClickHouseBackupCronJobSuspended` | warning  | `spec.suspend` is set, so nothing is being scheduled                         |
| `ClickHouseBackupCronJobMissing`   | critical | No `kube_cronjob_info` series: the CronJob is gone, or kube-state-metrics is |

`ClickHouseBackupStale` is the one that matters. The other three are there to
name a cause faster than the staleness window elapses, or, in the case of
`CronJobMissing`, to make sure the absence of data is itself an alert.

Every alert carries `backup` and `cronjob` labels, so the alert text names which
backup is broken and which object to look at.

## Why freshness, not failure

A failure alert answers "did a run report an error". That is not the question.
The question is "is there a restorable backup from within the window", and
several ways of losing backups produce no failure event at all:

- the CronJob is suspended, so no Job is ever created
- the CronJob is deleted, along with every metric a failure alert would read
- the schedule is edited to something that fires rarely, or never
- the Job succeeds while the backup it produced is empty or partial

The first three are covered here. The fourth is not; see the gaps section.

The freshness rule has two branches, and the second one is the important one:

```promql
time() - max by (namespace, cronjob) (kube_cronjob_status_last_successful_time{...}) > N
or
(time() - max by (namespace, cronjob) (kube_cronjob_created{...}) > N)
  unless max by (namespace, cronjob) (kube_cronjob_status_last_successful_time{...})
```

A CronJob that has **never** succeeded has no
`kube_cronjob_status_last_successful_time` series at all. The first branch is a
subtraction against an empty vector, which is empty, so on its own it would stay
quiet forever for a backup that was broken from the day it shipped. That is
precisely the shape of the incident this page exists for. The second branch
catches it by comparing against the CronJob's own age instead, gated so a fresh
install does not alert before its first run is due.

`tests/backup-alerts.sh` asserts both branches survive.

## Responding to `ClickHouseBackupStale`

The alert names the CronJob. Work down this list.

**1. Is the CronJob scheduling at all?**

```bash
kubectl -n <namespace> get cronjob <cronjob>
```

`SUSPEND=True` means someone paused it. `LAST SCHEDULE=<none>` or a stale
timestamp means the schedule is wrong or the controller is not firing it.
Compare `SCHEDULE` against what the chart's values say it should be; a manual
`kubectl patch` that never got folded back into the release is a common cause.

**2. What did the most recent runs do?**

```bash
kubectl -n <namespace> get jobs --sort-by=.metadata.creationTimestamp | tail
kubectl -n <namespace> logs job/<most-recent-job> --tail=200
```

`successfulJobsHistoryLimit`/`failedJobsHistoryLimit` are 1 on these CronJobs, so
only the newest of each survives. If the failure is older than that, the logs are
already gone and the next scheduled run is the fastest way to reproduce it.

**3. Is it failing for a reason the logs bury?**

Backup scripts that pipe a transfer tool's progress output produce megabytes of
carriage-return spam, and a failure thousands of lines up does not appear at the
tail. Search the whole log rather than reading the end of it:

```bash
kubectl -n <namespace> logs job/<most-recent-job> | grep -iE 'error|denied|failed|fatal'
```

A script running under `set -e` aborts at the first failure, so its final
"completed" line never prints. The absence of a success line is a signal; the
presence of a last line that looks like normal output is not.

**4. Force a run to test a fix.**

```bash
kubectl -n <namespace> create job --from=cronjob/<cronjob> <cronjob>-manual-$(date +%s)
```

Delete the manual Job afterwards so it does not sit in the history.

## Responding to `ClickHouseBackupCronJobMissing`

Two very different causes, and the alert cannot tell them apart:

```bash
kubectl -n <namespace> get cronjob <cronjob>     # exists?
kubectl -n <namespace> get pods -l app.kubernetes.io/name=kube-state-metrics -A
```

If the CronJob is there, kube-state-metrics is down or is no longer being
scraped, and **every backup alert is blind for as long as that lasts**. Treat it
with the same urgency as a missing backup, because you no longer know whether
backups are running.

If the CronJob is genuinely gone, either the release was deployed with
`backup.enabled=false`, or the target is stale: a backup that was deliberately
retired should be removed from `backup.monitoring.targets` in the same change
that removes the CronJob, not left to alert.

## Tuning

`staleAfterHours` should be at least two scheduling intervals. One interval
alerts on any single retried run; two plus a margin means a genuine gap. The
defaults are 26h for a 12-hourly full backup and 3h for an hourly incremental.

If an alert is noisy, raise the window or fix the backup. Do not silence it: a
muted backup alert is indistinguishable from the state this page exists to
prevent.

## What these alerts do not cover

Worth knowing, because it is tempting to read a green board as "backups are
fine".

- **Backup contents.** The alerts prove a Job reached a successful exit, not
  that what it wrote is complete or restorable. A backup process that reports
  success while silently skipping most of its data looks healthy here. Only a
  restore test proves restorability.
- **Restore.** Nothing here exercises the restore path. A backup that has never
  been restored from is an untested backup.
- **Retention and lifecycle.** If an object lifecycle rule expires backups
  sooner than intended, or an incremental outlives the full backup it is based
  on, every CronJob still succeeds and every alert here stays quiet.
- **Non-CronJob backup mechanisms.** Anything that is not a Kubernetes CronJob
  in the release namespace, such as a cloud-provider snapshot policy, publishes
  no kube-state-metrics series and cannot be watched from these rules. It needs
  a freshness signal from its own provider.
- **The scrape path.** `ClickHouseBackupCronJobMissing` catches
  kube-state-metrics disappearing, but if Prometheus itself stops evaluating
  rules, nothing here notices. That belongs to whatever watches Prometheus.

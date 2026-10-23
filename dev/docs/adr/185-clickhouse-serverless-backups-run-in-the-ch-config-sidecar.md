# ADR-185: clickhouse-serverless backups run in the ch-config sidecar, decided by pure functions

**Date:** 2026-10-23

**Status:** Accepted

## Context

The public `langwatch/clickhouse-serverless` image took native backups with two bash scripts, run by the chart as CronJobs: a full every 12 hours and an incremental every hour, to the `backups` disk (an `s3_plain` disk on the operator's object store). LangWatch's own deployment had moved ahead of those scripts. Each of its changes came from a production incident: an incremental that found no base after a server restart, an orphaned in-flight entry that blocked every later run, a full and an incremental overlapping, every incremental breaking when the backup host moved to another replica, hourly incrementals each carrying three days of change, and runs that exited 0 without writing a backup, which blinded the alerts.

Three further problems were structural. Shell is a poor home for that many rules: none of them had a test. A CronJob runs a client that blocks on a synchronous `BACKUP`, so killing the Job pod is the only lever, and the state of a run lives in a container that is gone by the time anyone looks. And the only health signal was kube-state-metrics on the CronJob objects, which says whether a Job exited 0, not whether a backup exists.

The image is public. Whatever replaces the scripts must stay generic (no cloud-specific code), off by default, and must not break an existing chart install, its env vars or the script paths runbooks name.

## Decision

### 1. One Go implementation, three callers

`internal/backup` holds the backup logic; `ch-config backup run|restore|list` runs it once; `ch-config sidecar` runs it on a schedule; `scripts/backup-data.sh` and `scripts/restore-data.sh` become `exec ch-config backup ...` shims at their old paths, with every env var keeping its meaning. ClickHouse is reached over its HTTP interface (`CLICKHOUSE_HTTP_PORT`, default 8123).

### 2. Decisions are pure functions

`Decide(mode, state, policy, now, adopt)` takes what the system tables report (in-flight entries from `system.backups`, completed backups from `system.backup_log`, the count of fulls ever) and returns one of: start (with a base when incremental), adopt, stand down, or fail. Every production rule is a branch of it and a row of its tests:

- Only a backup the server reports `BACKUP_CREATED` is a success. A failed read is a failure, never an absent conflict.
- A same-mode backup in flight blocks the run. An incremental stands down for a full in flight; a full never yields. Standing down is the one success that writes nothing, because the full covers it and reports its own result.
- `CREATING_BACKUP` entries older than `STALE_BACKUP_HOURS` are orphans.
- The base comes from `system.backup_log`, which survives restarts. With `BACKUP_CLUSTER`, it is read from every replica with `clusterAllReplicas(...)` and `skip_unavailable_shards = 1`, since all replicas share the backups disk.
- A base is at most `BACKUP_RETENTION_DAYS` less one day old, with a 12 hour floor. Fulls that all expired fail the run; no full ever is a clean no-op.
- Each incremental chains on the newest backup since the newest valid full. Only an incremental started after that full ended counts, so one that overlapped the full, and roots in the previous full, never becomes a base.
- `max_backup_bandwidth` reaches the statement.

All SQL is built in one file. Database names, backup paths and cluster names are validated against allow-lists, then backquoted or quoted with escapes. Names keep the `<db>_<mode>_<YYYYMMDDTHHMMSSZ>` format of the earlier public script; the `<mode>-YYYYMMDD_HHMMSS` names of earlier deployments are read as the configured database's and chain too.

Before reading the log the engine runs `SYSTEM FLUSH LOGS`, so a backup that completed seconds earlier is visible, and so every sidecar's server has a `backup_log` table: a cluster read fails on a replica that has none.

### 3. ASYNC, polled by id

`BACKUP ... SETTINGS id = '<name>' ... ASYNC` hands the backup to the server and returns at once; the caller polls `system.backups` by id, falling back to `backup_log` when a server restart emptied the in-memory table. A dying caller never stops a backup. On start, the sidecar adopts a same-mode backup in flight and reports its outcome instead of starting a second one. A one-shot run keeps the stricter rule and fails, as the scripts did.

### 4. Scheduling in-process

The sidecar evaluates five-field cron expressions in UTC (`BACKUP_FULL_SCHEDULE`, `BACKUP_INCREMENTAL_SCHEDULE`; defaults are the chart's CronJob schedules). LangWatch's own cadence is the documented example: `0 5 */3 * *` for fulls and `30 * * * *` for incrementals. A firing is owed until a backup of its mode completes after it, whoever wrote it. A restart across a firing therefore catches up rather than skipping three days, and a backup a CronJob or another runner finished counts. A failed slot gets one retry after ten minutes, like a CronJob with `backoffLimit: 1`.

### 5. One runner, by ordinal with failover

Every replica runs the sidecar. The runner is the replica at `BACKUP_RUNNER_ORDINAL` while it answers, else the next replica that answers, wrapping. Each sidecar reads the order from `system.clusters` and asks which replicas answer with `SELECT DISTINCT _shard_num FROM clusterAllReplicas(...)`. Every healthy server sees the same set and picks the same runner. A server that cannot read its peers runs only if it is the configured ordinal, so a partition never makes a blind replica elect itself. The cluster-wide in-flight check stays the second guard: if two runners ever overlap, the second sees the first's backup and adopts it.

We chose this over a lease. A lease needs somewhere to keep it: Keeper exists only on replicated installs and a lease table needs schema and writes. The ordinal needs neither and degrades in the safe direction. Its one gap is a runner whose ClickHouse answers while its sidecar is broken: no other replica takes over. The `ClickHouseBackupNoRunner` and stale alerts below make that loud instead of quiet.

### 6. The runner's own telemetry, built to fail loudly

The sidecar serves `/metrics` (Prometheus text, written by hand so the module gains no dependency), `/status` (the same as JSON) and `/healthz` on `BACKUP_METRICS_LISTEN`. Per mode: last success (from `backup_log`, so it counts any writer and survives restarts), last attempt, last failure, last duration and size, a failures counter and in-flight; plus whether this pod is the runner, the sidecar's start time and a configuration-error flag.

The CronJob alerts avoided self-telemetry because a backup that stops running reports nothing. The sidecar rules answer that directly: the stale rule has a branch for a backup that never succeeded, gated on the sidecar's age; `ClickHouseBackupNoRunner` fires on `absent(clickhouse_backup_runner)` as well as on no runner; and a broken configuration has its own alert. The CronJob rules stay as they are and render whenever CronJobs do.

### 7. Never the cause of an outage

A backup failure never ends the sidecar process: configuration errors are logged and reported, panics in a run are recovered, the metrics listener retries. The chart's sidecar has a liveness probe and no readiness probe. A crash-looping sidecar container would make the whole pod unready.

The sidecar logs in with `BACKUP_USER` and a password file (`BACKUP_PASSWORD_FILE`), never a password in its environment, and never assumes the `default` user. The login sits behind `chclient.Credentials`, re-read on every request, so the dynamic-users mode the access sidecar is gaining (a per-boot bootstrap password) is one more implementation. One-shot commands also accept `CLICKHOUSE_PASSWORD`, which the CronJobs pass today.

### 8. Retention stays with the object store

The earlier public script pruned with `DROP BACKUP`, which ClickHouse does not have, with its errors discarded, so it never removed a backup. We do not replace it. Deleting the right objects safely means knowing every live chain, and an object-store lifecycle rule on the backups prefix, which every S3-compatible store offers, already expires them. `BACKUP_RETENTION_DAYS` must match that rule; the base age limit keeps every chain inside it.

### 9. Chart modes

`backup.mode` is `cronjob` (the default, manifests unchanged), `sidecar` (no backup CronJobs; the restore template stays) or `cronjob-observe` (CronJobs back up; the sidecar runs with `BACKUP_SIDECAR=observe`, deciding and reporting but never sending a `BACKUP`). Observe mode is how a deployment runs both side by side without double backups, and checks the sidecar's metrics and alerts against real backups before switching.

## Rationale / Trade-offs

A sidecar beats a better CronJob because the state of a run (what is in flight, what the last attempt did) lives in a process that outlasts the run and can be asked about it. The cost is a second process in the ClickHouse pod, which the access sidecar (ADR-184) already put there; backups add a goroutine and an HTTP listener to it.

Ordinal election accepts one uncovered failure (section 5) for having no lease store and no clock assumptions. Pure decision functions cost a gather step that reads more than a single SQL query would, in exchange for every incident rule being a test.

## Consequences

- Existing chart installs see no change until they set `backup.mode`. The scripts keep working with the same env, now with the production rules: an incremental with no full is a no-op instead of a silent full, and the never-working prune is gone.
- Backups taken by the sidecar and by the shims share one naming scheme and one history, so a deployment can move between modes, or roll back, without losing its chain.
- The sidecar needs a ClickHouse login with `BACKUP`, `SYSTEM FLUSH LOGS` and read access to `system.backups`, `system.backup_log` and `system.clusters`, plus `remote` for the cluster reads.
- `_shard_num` ordering in `clusterAllReplicas` and log-table creation by `SYSTEM FLUSH LOGS` are relied on for replicated installs; CI's e2e covers a single server.

## References

- Spec: [`specs/clickhouse/serverless-backups.feature`](../../../specs/clickhouse/serverless-backups.feature)
- Related ADRs: [ADR-184](./184-clickhouse-serverless-access-tiers-rolling-passwords-and-token-logins.md) (the sidecar this extends)
- Code: `infra/clickhouse-serverless/internal/backup`, `internal/chclient`; chart `charts/clickhouse-serverless` (`backup.mode`); runbook `dev/docs/runbooks/clickhouse-backup-alerts.md`
- ClickHouse: `BACKUP ... ASYNC` and `system.backups` / `system.backup_log` (docs: Backup and Restore), `clusterAllReplicas`, `skip_unavailable_shards`

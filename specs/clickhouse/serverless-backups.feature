Feature: clickhouse-serverless takes chained native backups from CronJobs or its own sidecar
  As an operator running the public clickhouse-serverless image
  I want full and incremental backups that never report success without a backup,
  scheduled either by CronJobs or by the sidecar in the ClickHouse pod
  So that a broken backup is always loud, and switching schedulers loses nothing

  # ADR-185 (dev/docs/adr/185-clickhouse-serverless-backups-run-in-the-ch-config-sidecar.md).
  # The decision is a pure function of system.backups, system.backup_log, configuration and now.

  @unit
  Scenario: A backup run never reports success without writing a backup
    Given a run whose system-table reads fail, or whose backup the server fails or loses
    When the run ends
    Then it is a failure
    And only a backup the server reports as BACKUP_CREATED counts as a success

  @unit
  Scenario: A same-mode backup in flight blocks the run
    Given a full or incremental backup of the database is still being written on any replica
    When a one-shot run of the same mode starts
    Then it fails and starts no second backup

  @unit
  Scenario: An incremental gives way to a full in flight, and a full never gives way
    Given a full backup is being written
    When an incremental is due
    Then it stands down without writing anything and without failing
    And a full that is due while an incremental runs still starts

  @unit
  Scenario: In-flight entries older than STALE_BACKUP_HOURS are orphans
    Given a CREATING_BACKUP entry older than STALE_BACKUP_HOURS
    When a run decides
    Then that entry neither blocks it nor makes an incremental stand down

  @unit
  Scenario: The base is looked up in the persistent backup_log, on every replica
    Given BACKUP_CLUSTER names the cluster
    When an incremental looks up its base
    Then it reads system.backup_log through clusterAllReplicas with skip_unavailable_shards
    And without a cluster it reads this server's system.backup_log

  @unit
  Scenario: A base older than retention less a day is never used
    Given every full backup completed longer ago than BACKUP_RETENTION_DAYS less one day, with a 12 hour floor
    When an incremental is due
    Then it fails, saying the newest full has expired

  @unit
  Scenario: An incremental with no full ever is a clean no-op
    Given no full backup of the database has ever completed
    When an incremental is due
    Then it writes nothing and exits 0

  @unit
  Scenario: Each incremental chains on the newest backup since the newest valid full
    Given a valid full and incrementals started after it ended
    When an incremental is due
    Then its base is the newest of those, or the full when there is none
    And an incremental that overlapped the full is never a base

  @unit
  Scenario: The bandwidth cap reaches the BACKUP statement
    Given BACKUP_MAX_BANDWIDTH is set
    When a backup starts
    Then the BACKUP statement carries max_backup_bandwidth and runs ASYNC

  @unit
  Scenario: Names and identifiers are validated and quoted before they reach SQL
    Given a database, backup name or cluster name holding quotes, spaces, dots or ".."
    When a statement is built
    Then it is refused, and every accepted name is backquoted or quoted with escapes

  @unit
  Scenario: A restore needs an explicit name and confirmation
    Given a restore without --confirm, without a name, with "latest", or with an unsafe name
    When it runs
    Then it refuses before connecting and restores nothing

  @unit
  Scenario: The sidecar adopts a backup in flight instead of starting a second
    Given the sidecar restarted while its backup kept running on the server
    When it starts again
    Then it waits for that backup and reports its outcome, and starts no second one

  @unit
  Scenario: A scheduled firing is owed until a backup of its mode completes after it
    Given a cron schedule for each mode
    When the sidecar was down across a firing, or a CronJob completed the backup, or a run failed
    Then it catches up, counts the other backup, or retries once after ten minutes

  @unit
  Scenario: Exactly one replica runs backups, failing over to the next that answers
    Given every replica runs the sidecar and BACKUP_RUNNER_ORDINAL names one
    When that replica answers, or does not
    Then it alone runs backups, or the next replica that answers does
    And a replica that cannot see its peers runs only if it is the configured one

  @unit
  Scenario: Observe mode decides and reports but never backs up
    Given BACKUP_SIDECAR=observe
    When backups are due
    Then the sidecar records what it would do on /metrics and sends no BACKUP

  @unit
  Scenario: The runner reports its own telemetry on /metrics and /status
    Given the sidecar ran backups
    When /metrics and /status are read
    Then they give last success, attempt and failure per mode, last duration and size, failures, in-flight and whether this pod is the runner

  @unit
  Scenario: A bad backup configuration never takes the sidecar down
    Given an invalid schedule, cap, database, cluster or a password only in the environment
    When the sidecar starts
    Then it reports the error on /metrics and keeps running, so ClickHouse stays ready

  @unit
  Scenario: The image runs the backup sidecar in-process when asked, logging in from a file
    Given a container without a sidecar of its own and BACKUP_SIDECAR set
    When the entrypoint starts
    Then it runs the sidecar with a password file and without CLICKHOUSE_PASSWORD

  @unit
  Scenario: The chart keeps CronJob mode as the default
    Given backups enabled with the chart's default values
    When it is rendered
    Then the full and incremental CronJobs render and the pod runs no sidecar

  @unit
  Scenario: In sidecar mode the chart runs no backup CronJobs and wires the sidecar
    Given backup.mode=sidecar
    When the chart is rendered
    Then no backup CronJob renders, the restore template does
    And the sidecar gets the schedules, the password as a file and a metrics port, and no readiness probe

  @unit
  Scenario: Observe mode keeps the CronJobs and runs the sidecar beside them
    Given backup.mode=cronjob-observe
    When the chart is rendered
    Then the CronJobs render and the sidecar runs with BACKUP_SIDECAR=observe

  @unit
  Scenario: Sidecar-mode alerts read the runner's own metrics
    Given backup monitoring is on in sidecar mode
    When the alert rules are rendered
    Then each mode has a stale and a failing alert on the sidecar's metrics
    And a missing runner, two runners or an invalid configuration alert too

  @unit
  Scenario: In dynamic-only mode the backup runner logs in as the per-boot local admin
    Given the local admin's password directory is present and the server is on loopback
    When the backup runner or a one-shot command logs in
    Then it uses the local admin, re-reading the password on every request
    And against a remote host, or without the directory, it uses the password file

  @unit
  Scenario: Dynamic-only mode refuses backup CronJobs and runs sidecar backups as the local admin
    Given access.dynamicOnly.enabled and backups enabled
    When the chart is rendered in cronjob or cronjob-observe mode
    Then it is refused, since a CronJob has no password to log in with
    And in sidecar mode the access container runs backups with the local admin's directory and no static password

  @integration
  Scenario: A real ClickHouse takes, chains and restores backups, and the sidecar survives a restart mid-backup
    Given the image with a backups disk on an S3-compatible store
    When the scripts take a full and chained incrementals, and the sidecar is killed while its full runs
    Then the full completes, the restarted sidecar adopts it, chains an incremental on it
    And every chain restores all of its rows

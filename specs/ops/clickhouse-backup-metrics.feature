Feature: ClickHouse backup status metrics are opt-out
  Backup monitoring only makes sense where ClickHouse backups are actually
  configured (the production cluster, backed by the clickhouse-serverless
  chart's backup cronjobs). Everywhere else — local dev, CI, self-hosted
  installs without backups — querying system.backup_log would fail on every
  collection tick for nothing. NODE_ENV is not a reliable signal for "backups
  exist here" (staging and self-hosted also run production builds), so the
  environments WITHOUT backups say so explicitly.

  The gate defaults to ON, not off. The gauges predate the flag and live Grafana
  alerts (clickhouse_backup_last_success_timestamp_seconds,
  clickhouse_backup_status_total, and the "Backup Reporting Absent" rule built on
  them) already read them from deployments that set nothing. A default-off flag
  would silently disarm production backup monitoring the moment it shipped, so
  absence of configuration keeps the existing behaviour and only a deliberate
  opt-out stops collection.

  Scenario: a deployment that says nothing keeps collecting backup status
    Given CLICKHOUSE_BACKUP_METRICS_ENABLED is not set
    When the storage stats collector ticks
    Then backup status is collected from the ClickHouse backup log

  Scenario: a deployment with backups collects backup status
    Given backup metrics collection is enabled for the deployment
    When the storage stats collector ticks
    Then backup status is collected from the ClickHouse backup log

  Scenario: a deployment without backups opts out of the backup log query
    Given backup metrics collection is explicitly disabled
    When the storage stats collector ticks
    Then the ClickHouse backup log is never queried
    And table and disk storage stats are still collected

  Scenario: an unrecognised value is treated as enabled
    Given CLICKHOUSE_BACKUP_METRICS_ENABLED is set to an unparseable value
    When the storage stats collector ticks
    Then backup status is collected from the ClickHouse backup log

  Scenario: transient backup-log failure warns once until recovery
    Given backup metrics collection is enabled
    When the backup log query fails on consecutive ticks
    Then a single warning is logged for the failure streak
    And a recovery is logged once collection succeeds again

  # The Helm chart states the toggle explicitly in both directions, coupled to
  # the backup config, so a chart deployment never depends on the app's default.
  Scenario: the Helm chart enables backup metrics wherever it runs backups
    Given the langwatch chart is deployed with clickhouse.backup.enabled true
    When the app and worker deployments are rendered
    Then CLICKHOUSE_BACKUP_METRICS_ENABLED is set to true on them

  Scenario: an operator forces backup metrics for out-of-band backups
    Given the langwatch chart is deployed with clickhouse.backup.metricsEnabled true
    And chart-managed backups are disabled
    When the app and worker deployments are rendered
    Then CLICKHOUSE_BACKUP_METRICS_ENABLED is set to true on them

  Scenario: the Helm chart opts out where it knows there are no backups
    Given the langwatch chart is deployed with clickhouse backups disabled
    When the app and worker deployments are rendered
    Then CLICKHOUSE_BACKUP_METRICS_ENABLED is set to false on them

  Scenario: haven opts local worktrees out
    Given a haven stack manages its own ClickHouse
    When the portless overlay is rendered
    Then CLICKHOUSE_BACKUP_METRICS_ENABLED is set to false in it

Feature: ClickHouse backup status metrics are opt-in
  Backup monitoring only makes sense where ClickHouse backups are actually
  configured (the production cluster, backed by the clickhouse-serverless
  chart's backup cronjobs). Everywhere else — local dev, CI, self-hosted
  installs without backups — querying system.backup_log would fail on every
  collection tick for nothing. NODE_ENV is not a reliable signal for "backups
  exist here" (staging and self-hosted also run production builds), so the
  deployment that has backups opts in explicitly.

  Scenario: deployment with backups opts in to backup monitoring
    Given backup metrics collection is enabled for the deployment
    When the storage stats collector ticks
    Then backup status is collected from the ClickHouse backup log

  Scenario: deployment without backups never queries the backup log
    Given backup metrics collection is not enabled
    When the storage stats collector ticks
    Then the ClickHouse backup log is never queried
    And table and disk storage stats are still collected

  Scenario: transient backup-log failure warns once until recovery
    Given backup metrics collection is enabled
    When the backup log query fails on consecutive ticks
    Then a single warning is logged for the failure streak
    And a recovery is logged once collection succeeds again

  # The opt-in must not let production silently stop emitting the gauges the
  # "Backup Reporting Absent" alert depends on. The Helm chart couples the toggle
  # to the backup config so the signal can never drift from whether backups run.
  Scenario: the Helm chart enables backup metrics wherever it runs backups
    Given the langwatch chart is deployed with clickhouse.backup.enabled true
    When the app and worker deployments are rendered
    Then CLICKHOUSE_BACKUP_METRICS_ENABLED is set to true on them

  Scenario: an operator forces backup metrics for out-of-band backups
    Given the langwatch chart is deployed with clickhouse.backup.metricsEnabled true
    And chart-managed backups are disabled
    When the app and worker deployments are rendered
    Then CLICKHOUSE_BACKUP_METRICS_ENABLED is set to true on them

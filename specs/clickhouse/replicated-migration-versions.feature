Feature: goose never reruns a migration on a replicated ClickHouse
  Cloud runs ClickHouse as several replicas behind a round-robin load
  balancer. goose reads its version table before every migration, and each
  read can land on a replica that has not fetched the last version row yet.
  A stale read reruns a migration that already ran, and an INSERT ... SELECT
  rebuild then duplicates its rows. The upgrade's own read after goose saw
  the same lag and reported a finished migration as not done.

  @unit
  Scenario: On a cluster every goose write waits for every replica
    Given CLICKHOUSE_CLUSTER is set and its shard has three replicas
    When goose is given its connection
    Then every insert goose makes returns only once all three replicas hold it
    And the version row the run inserts itself waits for all three as well

  @unit
  Scenario: On a cluster every replica catches up before goose reads its versions
    Given CLICKHOUSE_CLUSTER is set
    When the migration run prepares goose's version table
    Then it syncs that table on every replica of the cluster, not only the one it reached
    And a replica that cannot catch up fails the run instead of serving goose a stale read

  @unit
  Scenario: A single ClickHouse runs goose exactly as before
    Given CLICKHOUSE_CLUSTER is not set
    When goose is given its connection
    Then its connection string is unchanged
    And no replica is synced and no write waits for a quorum

  @unit
  Scenario: A database holding tables with no version history at all is refused
    Given a ClickHouse database holds application tables
    And its version table records no migration, after every replica has caught up
    When the migration run bootstraps that database
    Then it refuses before any migration runs and changes nothing
    And it names restoring the version history, never dropping the database

  @unit
  Scenario: A database with a version history or no tables bootstraps as usual
    Given a ClickHouse database either records a migration or holds no table of ours
    When the migration run bootstraps that database
    Then it does not refuse

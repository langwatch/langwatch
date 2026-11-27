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
  Scenario: A write refused for a replica that is still starting is retried
    Given CLICKHOUSE_CLUSTER is set and one of the three replicas has not brought a table up yet
    When ClickHouse refuses a goose write with TOO_FEW_LIVE_REPLICAS
    Then the run logs the alive and required replica counts from the refusal and waits a short, growing backoff
    And it runs goose again, which skips the versions it already applied, until the write is accepted

  @unit
  Scenario: A replica that never comes back fails the run with the count it is missing
    Given ClickHouse keeps refusing goose's writes with TOO_FEW_LIVE_REPLICAS
    When CLICKHOUSE_MIGRATE_WAIT_SECONDS runs out
    Then the run fails in the migrate phase, naming how many replicas are alive and how many are missing
    And any other migration failure fails the run at once, without a retry

  @unit
  Scenario: A single ClickHouse runs goose exactly as before
    Given CLICKHOUSE_CLUSTER is not set
    When goose is given its connection
    Then its connection string is unchanged
    And no replica is synced and no write waits for a quorum

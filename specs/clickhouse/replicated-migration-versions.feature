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
  Scenario: On a cluster goose starts only once every replica answers
    Given CLICKHOUSE_CLUSTER is set and one of its three replicas is still starting
    When the migration run prepares goose's version table
    Then it waits, logging how many of the three replicas answer on each check
    And it starts goose only once all three answer, so no all-replica write is refused for a missing replica

  @unit
  Scenario: A replica that never answers fails the run with the count it is missing
    Given CLICKHOUSE_CLUSTER is set and one of its three replicas does not answer
    When CLICKHOUSE_MIGRATE_WAIT_SECONDS runs out
    Then the run fails in the bootstrap phase, naming the cluster, the replicas that answer and how many are missing
    And goose is not started

  @unit
  Scenario: A single ClickHouse runs goose exactly as before
    Given CLICKHOUSE_CLUSTER is not set
    When goose is given its connection
    Then its connection string is unchanged
    And no replica is synced and no write waits for a quorum
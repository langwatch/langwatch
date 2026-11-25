Feature: Ops dashboard queue discovery without keyspace scans
  As the platform
  I want the ops dashboard to enumerate group queues from a registry
  So that polling the dashboard never scans the whole Redis keyspace

  Context: the ops metrics collector ran SCAN MATCH *:gq:ready over the entire
  keyspace every 10 seconds in every pod. Once the keyspace grew to hundreds of
  thousands of keys (one set entry per group, never expired), each scan took tens
  of milliseconds and the continuous storm across pods pegged the single-threaded
  Redis. There is only ever a handful of ready sets, so scanning the whole keyspace
  to find them is wasteful.

  @unit
  Scenario: A starting producer advertises its queue name in the registry
    Given a group queue processor starts
    When it initializes
    Then its queue name is added to the queue registry set

  @unit
  Scenario: Discovery reads the registry set instead of scanning the keyspace
    Given queues have registered their names in the queue registry
    When the dashboard discovers queue names
    Then the names come from the registry set
    And the Redis keyspace is not scanned

  @unit
  Scenario: Discovery falls back to a one-time scan when the registry is empty
    Given the queue registry set is empty
    And a ready set exists in the keyspace
    When the dashboard discovers queue names
    Then the keyspace is scanned once to find the ready sets
    And the discovered names are backfilled into the registry

  @unit
  Scenario: Discovery returns nothing without backfilling when no queues exist
    Given the queue registry set is empty
    And no ready set exists in the keyspace
    When the dashboard discovers queue names
    Then no names are returned
    And nothing is written to the registry

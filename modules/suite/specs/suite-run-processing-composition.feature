# See ../adrs/001-suite-service-boundary.md

Feature: Composing durable suite-run processing

  Durable suite-run processing is a queue consumer. It folds a suite run's
  progress from the three commands the API and the simulation pipeline send,
  and writes the result to one ClickHouse table.

  Nothing about that needed the App, and yet only the App could build it: the
  fold store was assembled from three pieces held in three different places —
  the projection store on the suite runtime, the projection version in the
  contract, and the Redis read-through cache on the pipeline registry — so a
  process holding a ClickHouse client and a Redis still had no way to compose
  the pipeline. Stating the assembly in the feature is what makes it buildable
  by whichever process consumes it.

  The cache is part of the pipeline rather than an optimisation over it. It
  carries the applied-event ids a redelivery is dropped on, and this fold
  accumulates by addition, so a graph composed without one double-counts a
  redelivered item and can flip a run to SUCCESS or FAILURE before it has
  finished.

  @unit
  Scenario: Durable processing composes from one tenant-keyed client and one Redis
    Given a process that can route a tenant to its ClickHouse instance, and its own Redis
    When it composes durable suite-run processing
    Then the pipeline registers the same three deduplicated commands the App registers
    And it registers the run-state fold the App registers

  @unit
  Scenario: Suite-run state is written through the client this graph resolved
    Given durable suite-run processing composed over a tenant-keyed client
    When a suite run's folded state is stored
    Then the client is resolved for the tenant the state names
    And the row is stamped with the retention the substrate already carries

  @unit
  Scenario: Both graphs cache the run-state fold under one keyspace
    Given durable suite-run processing composed by a background worker
    When a suite run's folded state is stored
    Then the cache entry is written under the keyspace the App also reads

  @unit
  Scenario: Producer and consumer honour one fold cache TTL
    Given a fold cache TTL named in the environment
    When the worker composes durable suite-run processing
    Then cache entries are written with that TTL
    And a process that names none falls back to the replication-lag floor

  @unit
  Scenario: The worker mounts the pipeline rather than being handed one
    Given a worker graph composed with no suite capability passed in
    When the graph is composed
    Then the suite feature is mounted anyway, built from this process's own substrate

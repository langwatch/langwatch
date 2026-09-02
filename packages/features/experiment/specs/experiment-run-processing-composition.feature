Feature: Composing durable experiment-run processing

  Durable experiment-run processing is a queue consumer. It folds a run's
  progress, cost and pass rate from the five commands the workbench and the
  trace pipeline send, and writes the fold to one ClickHouse table while
  appending every individual result to another.

  Nothing about that needed the App, and yet only the App could build it: the
  run-state repository and the item append store were pre-built in the
  composition root, the Redis read-through cache over the fold was added by the
  pipeline registry, and neither of the two files was the feature's — so a
  process holding a ClickHouse client and a Redis still had no way to compose
  the pipeline. Stating the assembly in the feature is what makes it buildable
  by whichever process consumes it.

  The cache is part of the pipeline rather than an optimisation over it. It
  carries the applied-event ids a redelivery is dropped on, and this fold
  accumulates by addition — every target and evaluator result adds to the run's
  counts, costs and pass rate — so a graph composed without one double-counts a
  redelivered result and can complete a run on numbers that never happened.

  @unit
  Scenario: Durable processing composes from one tenant-keyed client and one Redis
    Given a process that can route a tenant to its ClickHouse instance, and its own Redis
    When it composes durable experiment-run processing
    Then the pipeline registers the same five commands the App registers
    And it registers the run-state fold and the run-item append the App registers

  @unit
  Scenario: Run state is written through the client this graph resolved
    Given durable experiment-run processing composed over a tenant-keyed client
    When a run's folded state is stored
    Then the client is resolved for the tenant the state names
    And the row is stamped with the retention the substrate already carries

  @unit
  Scenario: Run items are written through the same client and retention
    Given durable experiment-run processing composed over a tenant-keyed client
    When one run result is appended
    Then it is written to the run-item table through the client this graph resolved
    And it is stamped with the retention the substrate already carries

  @unit
  Scenario: Both graphs cache the run-state fold under one keyspace
    Given durable experiment-run processing composed by a background worker
    When a run's folded state is stored
    Then the cache entry is written under the keyspace the App also reads

  @unit
  Scenario: Producer and consumer honour one fold cache TTL
    Given a fold cache TTL named in the environment
    When the worker composes durable experiment-run processing
    Then cache entries are written with that TTL
    And a process that names none falls back to the replication-lag floor

  @unit
  Scenario: The worker mounts the pipeline rather than being handed one
    Given a worker graph composed with no experiment capability passed in
    When the graph is composed
    Then the experiment feature is mounted anyway, built from this process's own substrate

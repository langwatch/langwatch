Feature: Composing durable coding-agent session processing

  The ADR-056 session pipeline is a queue consumer. It folds one coding-agent
  session out of the span, log and metric facts three other pipelines
  contribute, writes the fold and three append projections to ClickHouse, and
  asks GitHub which pull requests the session's branch has hosted.

  Only the App could build it, and two of its ten dependencies were the reason:
  the whole `ModelProviderService`, to price a model call, and the whole
  `ProjectService`, to stamp one column. Neither is a service graph on
  inspection. Pricing is a pure function over the platform's immutable model
  catalog — `estimateCost` reads nothing else, and a tenant's custom rates
  travel on the span attributes rather than through a query — and the stamp is
  a single throttled `UPDATE` behind a one-method port. Naming what the
  pipeline actually calls is what makes it buildable by whichever process
  consumes it.

  The pull-request mapping subscriber is part of the pipeline rather than an
  extra. It is what registers `reactor:pullRequestMapping`, and the shared
  `event-sourcing/jobs` queue rejects an unroutable job for redelivery rather
  than dropping it — so a consumer that composed the pipeline without a GitHub
  demand path would stall every mapping job forever while looking healthy.

  @unit
  Scenario: Durable processing composes from one client, one Redis and one database
    Given a process that can route a tenant to its ClickHouse instance, its own Redis, and its Prisma client
    When it composes durable coding-agent session processing
    Then the pipeline registers the same three contribution commands the App registers
    And it registers the session fold, its three append projections and the cost-drift subscriber
    And it registers the pull-request mapping subscriber

  @unit
  Scenario: Session rows are written through the client this graph resolved
    Given durable coding-agent session processing composed over a tenant-keyed client
    When a folded session is stored
    Then the client is resolved for the tenant the session names
    And the row is stamped with the retention the substrate already carries

  @unit
  Scenario: Both graphs cache the session fold under one keyspace
    Given durable coding-agent session processing composed by a background worker
    When a folded session is stored
    Then the cache entry is written under the keyspace the App also reads

  @unit
  Scenario: Producer and consumer honour one fold cache TTL
    Given a fold cache TTL named in the environment
    When the worker composes durable coding-agent session processing
    Then cache entries are written with that TTL

  @unit
  Scenario: A model call is priced from the platform catalog alone
    Given the cost estimator this pipeline prices sessions with
    When a call on a catalogued model reports its tokens
    Then it is priced from the catalog's own rates
    And a call carrying custom per-token rates is priced from those instead

  @unit
  Scenario: Storing a session stamps its project's activity
    Given durable coding-agent session processing composed over a project seam
    When a folded session is stored
    Then the project is recorded as having seen coding-agent activity

  @unit
  Scenario: The worker mounts the pipeline rather than being handed one
    Given a worker graph composed with no coding-agent capability passed in
    When the graph is composed
    Then the coding-agent feature is mounted anyway, built from this process's own substrate
    And it is mounted before metric, log and trace, whose subscribers dispatch into it

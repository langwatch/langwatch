# See ../adrs/20260820-eventing-framework-boundary.md
# See ../../group-queue/adrs/20260820-group-queue-framework-boundary.md
Feature: Eventing framework boundary and pipeline authoring

  As a feature author
  I want to describe an event pipeline with substrate-aware inline builders
  So that its consistency guarantees are visible and invalid combinations are
  rejected before the application starts

  @typecheck @architecture
  Scenario: An aggregate declares its type once
    Given an aggregate definition with its identifier and allowed events
    When a pipeline is defined for that aggregate
    Then the pipeline derives its aggregate type from the definition
    And no separate aggregate-type registration is accepted

  @unit @architecture
  Scenario: The application composes an explicit event catalogue
    Given core and optional enterprise pipeline definitions
    When the application builds its installed event catalogue
    Then every installed event definition is available for decoding
    And Eventing did not import either application or enterprise code

  @unit @validation
  Scenario: Conflicting event definitions are rejected
    Given two installed events with the same type and different schemas
    When the application builds its event catalogue
    Then construction fails with both conflicting owners identified

  @typecheck @projection
  Scenario: A ClickHouse map projection requires its consistency dependencies
    Given an inline ClickHouse map projection
    When its definition omits a stable key, repository or Redis cache
    Then the projection cannot be built
    But prior-state evolution and Postgres options are not offered

  @unit @projection
  Scenario: A ClickHouse map projection replaces its latest keyed document
    Given a built ClickHouse map projection for a stable document key
    When a relevant event is processed successfully
    Then the event is mapped without reading prior projection state
    And the latest document is written to ClickHouse and its Redis cache

  @typecheck @projection
  Scenario: A ClickHouse fold projection requires a Redis-backed read path
    Given an inline ClickHouse fold projection
    When its definition omits initial state, evolution, repository, cache or version
    Then the projection cannot be built
    But Postgres-only options are not offered

  @integration @projection
  Scenario: A ClickHouse fold evolves the latest cached state
    Given a stored ClickHouse fold document whose durable read may be stale
    And a newer version of that document in the projection cache
    When the next relevant event is processed
    Then the pure evolution receives the cached version
    And the evolved document is persisted and written through to the cache

  @typecheck @projection
  Scenario: A Postgres projection exposes only its own substrate contract
    Given an inline Postgres projection
    When its definition supplies initial state, evolution, version and repository
    Then the projection can be built without a Redis projection cache
    And ClickHouse cache and append options are not offered

  @architecture @projection
  Scenario: Projection evolution stays deterministic and bounded
    Given production source is named as an Eventing projection
    When architecture lint checks the projection
    Then async functions, awaits, network modules, timers, dynamic imports and direct event appends are rejected
    And projection persistence remains the Eventing executor and projection store responsibility
    And runtime projection duration telemetry exposes CPU work that static lint cannot measure

  @unit @subscriber
  Scenario: An event subscriber receives no projection state
    Given an event subscriber interested in a declared event
    When that event is durably appended
    Then the subscriber is staged with the event context
    And no projection document is present in its handler contract

  @typecheck @subscriber
  Scenario: A projection subscriber infers its committed document
    Given a projection registered earlier in the pipeline
    When a projection subscriber is declared after that projection by name
    Then its handler receives the projection's inferred document type
    And an unknown or later projection name is rejected

  @unit @subscriber
  Scenario: A projection subscriber runs only after a successful projection write
    Given a projection subscriber attached to a fold projection
    When the projection repository fails to store its evolved document
    Then the subscriber is not staged
    When the projection later commits successfully on retry
    Then the subscriber is staged with exactly that committed document

  @architecture @subscriber @idempotency
  Scenario: A strict-package subscriber proves redelivery safety
    Given a feature subscriber performs an externally visible action
    When architecture lint checks the feature package
    Then a named redelivery test handles the same source event twice
    And the test observes one externally visible result
    And queue deduplication alone does not satisfy the rule

  @architecture @subscriber
  Scenario: A subscriber emits durable state through a command
    Given a subscriber reaction needs to create another durable domain event
    When its source is checked
    Then it invokes the owning feature command or pipeline
    And direct event construction or append is rejected

  @unit @replay
  Scenario: Replay rebuilds projections without repeating subscribers
    Given committed events for a selected aggregate
    When the replay engine applies them to selected projections
    Then projection state is rebuilt in event order
    And neither event nor projection subscribers are staged

  @integration @process-manager
  Scenario: A process manager consumes an event once and dispatches durable intent
    Given an inline process manager with a stable process key
    And a relevant event that has not been consumed by that process
    When the process manager handles the event
    Then its pure transition is persisted with an inbox record
    And resulting intents are persisted through its outbox contract
    And a retry does not apply the same event twice

  @architecture @process-manager
  Scenario: Process evolution and external work remain separate
    Given a feature owns a durable process manager
    When architecture lint checks its process and intent source
    Then process evolution is synchronous and derives only state, wakes and deterministic intents
    And network, timer, dynamic import and await work is rejected from the process definition
    And retry-safe external work lives in the matching intent executor
    And durable domain events enter through owning commands or pipelines

  @unit @process-manager
  Scenario: A process manager can schedule its next wake
    Given a process transition that returns a future wake time
    When the transition commits
    Then the wake is durably associated with that process key
    And waking re-enters the same typed process definition

  @unit @process-manager
  Scenario: An external signal advances an existing process synchronously
    Given an inline process manager declares a schema-validated signal
    And its process instance and current revision are durable
    When the runtime sends that signal with a caller-stable identity
    Then state, wake changes, the inbox identity and resulting intents commit atomically
    And the caller receives the committed state and revision
    But a signal cannot create a missing process instance

  @unit @process-manager @idempotency
  Scenario: Retrying a committed external signal recovers its durable state
    Given an external signal committed but its response was lost
    When a restarted caller sends the same signal identity again
    Then the pure signal transition is not run again
    And the caller receives the current durable process state
    And no duplicate intent is inserted

  @unit @process-manager @concurrency
  Scenario: External signals and wakes share one revision fence
    Given an external signal and a due wake read the same process revision
    When both attempt to commit a transition
    Then only one compare-and-swap wins that revision
    And the signal retries a revision loss against the winning state
    And exactly one transition's intents are inserted

  @typecheck @architecture
  Scenario: Eventing is sealed from application infrastructure
    Given the Eventing package dependency graph and public exports
    Then it contains no application, product, enterprise or Prisma import
    And consumers cannot deep-import repositories or executors
    And Eventing depends on Group Queue only through its public API

  @architecture @documentation
  Scenario: Framework rationale and behavior live with the owning package
    Given an ADR or feature spec about Eventing or Group Queue mechanics
    When its ownership is classified
    Then a framework document lives under the package that owns the invariant
    And a product document remains with its feature or application
    And every framework decision has one live source of truth

Feature: A module reacts to a peer pipeline's events from its own side

  A peer subscriber is declared on the reacting module's own pipeline and names the owner's
  event by the owner contract's type and data schema, so the edge runs from the reacting module
  to the owner and closes no construction or package-import cycle (dev/docs/ARCHITECTURE.md section 9). It rides the global
  registry: staged wherever the owner appends, delivered at least once, ordered per aggregate,
  re-driven through the hand-off outbox, never replayed.

  @unit
  Scenario: A module reacts to a peer pipeline's event from its own pipeline
    Given a module declares a peer subscriber on the owner's created event
    When the owner's pipeline appends that event, whichever pipeline registered first
    Then the subscriber is handed the event's data parsed with the contract's schema

  @unit
  Scenario: Several modules declare global lanes in one process
    Given one module declares a global map projection
    And another module declares a peer subscriber
    When the owner's pipeline appends an event both take
    Then both lanes receive it

  @unit
  Scenario: A global lane declared after routing started is refused by name
    Given the global registry started routing when consumers started
    When a later pipeline declares a peer subscriber
    Then registration is refused naming the subscriber's lane

  @unit
  Scenario: A peer subscriber carries its enqueue options and the event's instant
    Given a module declares a peer subscriber with a delay, a dedup and a group key
    When its lane registers on the global registry
    Then the lane carries those options
    And the handler is handed the event's occurredAt beside its tenant and aggregate

  @unit
  Scenario: A peer subscriber is handed the event's idempotency key beside its id
    Given a module declares a peer subscriber
    When the owner's pipeline appends one fact twice under one idempotency key
    Then the subscriber is handed both appends, each with its own event id and the shared key
    And an event without an idempotency key reaches the handler with none

  @unit
  Scenario: A peer subscriber's enqueue filter declines events before a job is minted
    Given a module declares a peer subscriber with an enqueue filter over the event's data
    When the owner's pipeline appends one event the filter takes and one it declines
    Then the lane's filter is handed each event's data parsed with the contract's schema
    And only the event the filter takes would mint a job
    And data the schema refuses is staged, so the handler's parse fails as it would unfiltered

  # Batching (ADR-066): a peer subscriber that declares handleBatch takes every delivery as a
  # batch, and may ask the queue to drain a backed-up group's due jobs into one call.

  @unit
  Scenario: A batch peer subscriber receives a backed-up group in one call
    Given a module declares a batch peer subscriber that coalesces up to three events
    When the queue drains two due events of one group together
    Then the subscriber is called once with both, in queue order
    And each carries its data parsed with the contract's schema and the context a single delivery gets

  @unit
  Scenario: A single delivery reaches a batch peer subscriber as a batch of one
    Given a module declares a batch peer subscriber
    When the queue delivers one event on its own
    Then the subscriber is called with a batch holding only that event

  @unit
  Scenario: An event the contract refuses fails its whole batch
    Given a module declares a batch peer subscriber
    When a batch holds an event whose data the contract's schema refuses
    Then the batch fails without calling the subscriber, so the queue splits it and retries

  @unit
  Scenario: A peer subscriber that handles one event at a time cannot ask to coalesce
    Given a module declares a peer subscriber with handle
    When it asks the queue to coalesce more than one event
    Then the declaration is refused naming the subscriber's lane
    And an event subscriber registered with coalescing but no batch handler is refused too

  @unit
  Scenario: A batch subscriber's lane asks the queue to coalesce
    Given an event subscriber with a batch handler that coalesces up to three events
    When its queue lane is registered
    Then the lane coalesces up to three jobs and takes a batch
    And a batch the queue hands it calls the batch handler once, with each event's context and the delivery attempt

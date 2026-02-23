Feature: Fold Projections

  Fold projections are stateful aggregations that reduce events into an accumulated
  state per aggregate. They are the primary way to build query-optimized views.

  Background:
    Given a registered fold projection "traceSummary" for aggregate type "trace"

  Scenario: Incremental state update
    Given no existing state for trace "trace-123"
    When a "span_received" event arrives for "trace-123"
    Then the projection is initialized via "init()"
    And the "apply(state, event)" function is called
    And the resulting state is persisted to the fold store

  Scenario: Sequential processing (FIFO)
    Given multiple events arrive for the same aggregate "trace-456"
    When the events are dispatched to the projection queue
    Then BullMQ GroupQueue ensures they are processed one at a time
    And they are processed in the order they arrived
    And each event is applied to the state produced by the previous event

  Scenario: Error handling and retries
    Given an event being processed for aggregate "trace-789"
    When the "apply" function or "store" operation fails
    Then the BullMQ job is retried with exponential backoff
    And the fold state remains at the last successfully persisted version
    And subsequent events for the same aggregate wait in the queue until retry succeeds

  Scenario: Rebuilding from events
    Given an existing fold projection with history
    When I trigger a manual update for an aggregate
    Then all events for that aggregate are retrieved from the EventStore
    And the state is recomputed from scratch using "init" and "apply"
    And the final state is persisted to the store

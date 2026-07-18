Feature: Durability-gated fold state cache

  Fold projections build state by reading what came before, applying an
  event, and writing the result back. The durable store is replicated, so
  a read can land on a replica that has not caught up yet and return state
  that is missing recent events. Folding on top of that silently loses
  whatever it was missing.

  A cache in front of the durable store closes that window. What makes it
  safe is when the cached copy is released: only once the durable store is
  confirmed to hold the state on every replica. A cache miss therefore
  means the durable store is known to be authoritative, so reading it is
  always correct.

  Background:
    Given a fold projection with a cached store
    And a durable store behind it

  Scenario: A cached entry is served without reading the durable store
    Given the fold state for aggregate "trace-1" is cached
    When the fold reads state for "trace-1"
    Then the cached state is returned
    And the durable store is not read

  Scenario: A miss reads the durable store
    Given the fold state for aggregate "trace-1" is not cached
    And the durable store holds state for "trace-1"
    When the fold reads state for "trace-1"
    Then the state is returned from the durable store

  Scenario: A cached entry is released once every replica holds the state
    Given the fold state for aggregate "trace-1" is cached
    And every replica of the durable store holds that state
    When the confirmation processor checks "trace-1"
    Then the cached entry is released

  Scenario: A cached entry is retained while any replica lags
    Given the fold state for aggregate "trace-1" is cached
    And one replica of the durable store has not caught up
    When the confirmation processor checks "trace-1"
    Then the cached entry is retained
    And "trace-1" is checked again later

  Scenario: A cached entry is retained when a replica cannot be reached
    Given the fold state for aggregate "trace-1" is cached
    And one replica of the durable store does not answer
    When the confirmation processor checks "trace-1"
    Then the cached entry is retained

  Scenario: An aggregate still being folded is never released
    Given a trace whose spans are still arriving
    When the confirmation processor runs repeatedly
    Then the cached entry for that trace is never released
    And it is released only after the trace stops receiving spans

  Scenario: An aggregate with work still in flight is not released
    Given the fold state for aggregate "trace-1" is cached
    And a fold job for "trace-1" is still in flight
    And every replica of the durable store holds that state
    When the confirmation processor checks "trace-1"
    Then the cached entry is retained

  Scenario: A redelivered event is not applied twice
    Given a fold job for aggregate "trace-1" failed after its state was stored
    When the job is retried with the same events
    Then those events are recognised as already applied
    And the aggregate reflects each event exactly once

  Scenario: The confirmation processor falling behind never loses state
    Given the confirmation processor is not running
    When fold states are stored for many aggregates
    Then every cached entry is retained
    And no fold reads state that is missing recent events

  Scenario: A cached entry cannot outlive its backstop
    Given a cached entry whose aggregate was never confirmed
    When the backstop period passes
    Then the cached entry is released
    And the release is reported as a backstop expiry rather than a confirmation

Feature: High-fan-in producers coalesce their event-log appends
  Some commands append one event per item — a trigger recording every match, for
  example. At high fan-in, one insert per item floods the event log with tiny
  parts faster than it can merge them, which stalls every writer that shares the
  table. A high-fan-in producer batches its appends into one insert per batch, so
  the event log stays off the per-item write path. (ADR-066, pillar 2.)

  Background:
    Given a command that appends one event per item it processes

  @unit
  Scenario: many items for one aggregate become one insert
    Given a single aggregate producing a burst of items faster than they drain
    When the producer processes the burst
    Then the items are appended to the event log as one batched insert per batch
    And not as one insert per item

  @unit @integration
  Scenario: coalescing preserves every item
    Given each item's event carries an identity that is stable across retries
    And the event log keeps a single record per event identity
    When a batch of items is coalesced into a single insert
    Then every item's event is durably recorded
    And the batch completes only after the insert is durably acknowledged
    And a retry of the batch neither duplicates nor drops events

  @integration
  Scenario: a batch is bounded by size as well as count
    Given a burst whose combined size would exceed the batch's byte budget before its count limit
    When the producer coalesces the burst
    Then the batch stops at the byte budget
    And the remaining items form the next batch

  @integration
  Scenario: a single oversized item is appended on its own
    Given one item larger than the batch's byte budget
    When it is the next item to process
    Then it is appended by itself
    And it does not wait for a batch it can never fill

  @unit
  Scenario: a low-fan-in producer is left alone
    Given a command that appends one event per human action
    When it records an action
    Then it appends immediately without waiting to batch

  @unit
  Scenario: an un-coalesced high-fan-in producer is visible, not silent
    Given a high-fan-in producer that does not coalesce its appends
    When its pipeline starts
    Then an operator-visible record names the producer, so the gap can be found and closed

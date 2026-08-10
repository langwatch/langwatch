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

  @unit
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

  @unit
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

  # A producer does not have to name a shard or bucket to funnel. When many
  # items share one aggregate — every log record and metric exemplar correlated
  # to a single trace — the DEFAULT group key is the funnel, and a chatty trace
  # parks thousands of items behind one consumer exactly as a hot shard would.
  # Observed live: one trace's correlated log records at 2,275 pending on a
  # single group, oldest 59 minutes, while every other trace's correlations
  # waited behind it.
  @unit
  Scenario: an aggregate that many items share is a funnel too
    Given a producer that names no group key of its own
    And many items per aggregate rather than one per human action
    When a burst of one aggregate's items is queued
    Then they are appended as one batched insert per batch
    And the aggregate's own fold stays ordered and exact

  # The guard above reads a producer's declared grouping, so it recognises an
  # explicit group key and an explicitly serialized aggregate — and misses the
  # funnel that arrives by the default key, which is the shape that shipped
  # un-coalesced. Fan-in per aggregate is a domain fact the registration site
  # cannot infer, so closing this needs a signal a producer states rather than
  # a broader reading of the ones it already has.
  @unit @unimplemented
  Scenario: a funnel on the default aggregate key is visible before it backs up
    Given a high-fan-in producer that names no group key of its own
    And that does not coalesce its appends
    When its pipeline starts
    Then an operator-visible record names the producer, so the gap can be found and closed

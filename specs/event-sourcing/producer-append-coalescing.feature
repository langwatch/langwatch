Feature: High-fan-in producers coalesce their event-log appends
  Some commands append one event per item — a trigger recording every match, for
  example. At high fan-in, one insert per item floods the event log with tiny
  parts faster than it can merge them, which stalls every writer that shares the
  table. A high-fan-in producer batches its appends into one insert per batch, so
  the event log stays off the per-item write path. (ADR-066, pillar 2.)

  # Fan-in does not require a shard key or a declared serialization. When many
  # items share one aggregate — every log record and metric exemplar correlated
  # to a single trace — the DEFAULT group key is already the funnel: that
  # aggregate's items drain through one consumer, one claim at a time, adding a
  # part per item and holding a fleet slot per claim. Other aggregates are not
  # queued behind it (they have their own groups); what they contend for is
  # slots and merge headroom.

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

  # Scoped to the grouping a producer DECLARES, because that is all the guard
  # reads. The complement — a producer that declares nothing and funnels on the
  # default aggregate key — is the scenario below, and it is not built.
  @unit
  Scenario: an un-coalesced producer that declares its grouping is visible, not silent
    Given a producer that serializes on an aggregate or names a shard key
    And it does not coalesce its appends
    When its pipeline starts
    Then an operator-visible record names the producer, so the gap can be found and closed

  # Not built. Fan-in per aggregate is a domain fact the registration site
  # cannot infer — every command groups on its aggregate by default, so
  # flagging that alone would name one-per-human-action commands too. Closing
  # this needs a signal a producer states about itself rather than a broader
  # reading of the ones it already declares.
  @unit @unimplemented
  Scenario: a funnel on the default aggregate key is visible before it backs up
    Given a producer whose items all belong to one aggregate
    And nothing it declares splits them across consumers
    And it does not coalesce its appends
    When its pipeline starts
    Then an operator-visible record names the producer, so the gap can be found and closed

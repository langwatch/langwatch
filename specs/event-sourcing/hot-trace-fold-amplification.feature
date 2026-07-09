Feature: Hot-trace fold amplification

  A trace whose spans arrive faster than the fold drains backs its fold group up.
  Two amplifiers turn that backlog into a stall that never recovers, and both are
  only visible on the very traces that can least afford them — the 10k-to-80k-span
  agent runs.

  # Why this exists — incident 2026-07-09
  #
  # Sharding recordSpan across GroupQueue lanes (span-command-sharding.feature)
  # let a hot trace's spans be handled in parallel. They therefore reach the fold
  # queue out of occurredAt order. The fold's out-of-order detector responded by
  # re-folding the whole trace from the event log, and because applying an event
  # raises the checkpoint to the highest occurredAt seen, that first re-fold
  # pinned the checkpoint at the trace's maximum event time — so every later
  # batch looked out of order too. One trace re-folded 730 times in two hours,
  # re-reading 5.66 million event rows out of ClickHouse to fold 73k spans.
  #
  # None of it bought anything. The trace summary is an order-insensitive fold:
  # its accumulators commute and its precedence rules read span timestamps, not
  # arrival order. A span can simply be folded when it arrives.
  #
  # Underneath it, each coalesced batch dispatched every reactor once per event.
  # Reactors keyed on the trace (evaluation trigger, trace-update broadcast,
  # alert trigger) collapse to a single queue job by dedup id, so 99 of every 100
  # sends were discarded — after each had serialized {event, foldState}, gzipped
  # it, and written a content-addressed blob into Redis that the dedup squash
  # immediately reclaimed.

  Background:
    Given a fold projection registered on the GroupQueue with coalescing enabled

  # ── Opting out of the out-of-order re-fold ─────────────────────────

  @unit @fold @refold
  Scenario: An out-of-order batch re-folds from the event log by default
    Given a fold whose persisted checkpoint is later than the batch's earliest event
    When the batch is folded
    Then the aggregate's full history is loaded and replayed from init state

  @unit @fold @refold
  Scenario: An order-insensitive fold never re-folds
    Given a fold that has opted out of re-folding on out-of-order events
    And a persisted checkpoint later than the batch's earliest event
    When the batch is folded
    Then the event log is never read
    And the batch is applied on top of the existing state in occurredAt order

  @unit @fold @refold
  Scenario: The trace summary is an order-insensitive fold
    Given the trace summary fold projection
    Then it has opted out of re-folding on out-of-order events

  @unit @fold @refold
  Scenario: Folding out-of-order spans without a re-fold still counts every span
    Given a trace summary with spans already folded
    And a batch of three span events that all occurred before the checkpoint
    When the batch is folded
    Then the event log is never read
    And the span count grows by three
    And the checkpoint does not regress

  @unit @fold @refold
  Scenario: A single out-of-order event honours the same opt-out
    Given a fold that has opted out of re-folding on out-of-order events
    And an event that occurred before the persisted checkpoint
    When the event is folded
    Then the event log is never read
    And the event is applied on top of the existing state

  # ── Collapsing the per-batch reactor fan-out ───────────────────────

  @unit @coalescing @reactors
  Scenario: Reactors keyed on the aggregate are dispatched once per coalesced batch
    Given a coalesced batch of five events for one aggregate
    And a reactor whose deduplication id is the same for every event in the batch
    When the batch is folded
    Then the reactor is dispatched once
    And it receives the last event in occurredAt order

  @unit @coalescing @reactors
  Scenario: Reactors keyed per event are still dispatched for every event
    Given a coalesced batch of five events for one aggregate
    And a reactor whose deduplication id includes the event id
    When the batch is folded
    Then the reactor is dispatched five times

  @unit @coalescing @reactors
  Scenario: Reactors without a deduplication id are dispatched for every event
    Given a coalesced batch of five events for one aggregate
    And a reactor with no deduplication id
    When the batch is folded
    Then the reactor is dispatched five times

  @unit @coalescing @reactors
  Scenario: The relevance check still filters events before collapsing
    Given a coalesced batch of five events for one aggregate
    And an aggregate-keyed reactor that finds only two of them relevant
    When the batch is folded
    Then the reactor is dispatched once
    And it receives the last relevant event

  # ── Guards run before enqueue, not after dispatch ──────────────────

  @unit @reactors
  Scenario: The origin guard filters a non-message event before enqueue
    Given a topic-assigned event on a trace with a resolved origin
    Then the origin-guarded reactor declines to react

  @unit @reactors
  Scenario: The origin guard filters a trace with no resolved origin before enqueue
    Given a span event on a trace whose origin is unresolved
    Then the origin-guarded reactor declines to react

  @unit @reactors
  Scenario: The origin guard admits a genuine message event before enqueue
    Given a recent span event on a recent trace with a resolved origin
    Then the origin-guarded reactor agrees to react

  @unit @reactors
  Scenario: The evaluation trigger declines past the span processing cap before enqueue
    Given a span event on a trace whose span count has passed the span processing cap
    Then the evaluation trigger declines to react

  @unit @reactors
  Scenario: The evaluation trigger declines a synthetic span before enqueue
    Given a synthetic span event on a trace with a resolved origin
    Then the evaluation trigger declines to react

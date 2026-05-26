Feature: Group-coalesced fold projections

  Fold projections accumulate state by reading the previous state, applying one
  event, and writing it back. Processed one event at a time, a single aggregate
  with N queued events costs N load+store round-trips over a state that grows
  with N — O(n²) on the accumulated state, which on a single-threaded Redis
  command path stalls the whole queue once a group backs up.

  # Why this exists — incident 2026-05-26
  #
  # A 233-span trace (a 50-turn red-team run, no media) backed its fold group
  # up. Each queued span re-read and re-wrote the multi-MB accumulated state,
  # 233 times, diverging instead of draining. Shrinking the payload only lowers
  # the constant; the structural maps (events, span costs, per-role spans) grow
  # with span count regardless. The fix is to drain a backed-up group's queued
  # events and fold them in a single load/apply/store cycle: O(n) for the
  # backlog, self-healing instead of diverging. When the queue keeps up, batches
  # are size 1 and the per-event path is unchanged.

  Background:
    Given a fold projection registered on the GroupQueue with coalescing enabled

  @unit @coalescing @fold
  Scenario: Folding several events reads once and stores once
    Given an aggregate with three queued events
    When the events are folded as one batch
    Then the store is read once and written once
    And the result reflects all three events

  @unit @coalescing @fold
  Scenario: Coalesced fold equals sequential folding
    Given the same three events for one aggregate
    When they are folded as one batch
    And separately folded one event at a time
    Then both produce the same final state

  @unit @coalescing @fold
  Scenario: Out-of-order events are folded in occurredAt order
    Given a batch of events received out of occurredAt order
    When the batch is folded
    Then the events are applied in occurredAt order

  @integration @coalescing @queue
  Scenario: A backed-up group is folded in a single batch call
    Given a group with ten queued events
    When the group is processed
    Then the events are delivered to the batch handler in one call
    And every event is processed exactly once

  @integration @coalescing @queue
  Scenario: Coalescing respects the configured max batch size
    Given a group with nine queued events and a max batch size of three
    When the group is processed
    Then no batch handed to the handler exceeds three events
    And every event is processed exactly once

  @integration @coalescing @queue
  Scenario: Coalescing is a no-op when disabled
    Given a group with five queued events and coalescing disabled
    When the group is processed
    Then each event is processed individually
    And the batch handler is never called

  @integration @coalescing @queue
  Scenario: A failed coalesced batch re-stages its drained siblings
    Given a group whose first batch attempt fails
    When the group is retried
    Then every event is eventually processed and none are lost

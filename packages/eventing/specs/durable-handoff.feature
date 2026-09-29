Feature: Durable hand-off from an append to its lanes
  As the operator of every reaction to an appended event
  I want a lane that fails to stage to be recorded and re-driven
  So that a projection, subscriber or process manager never silently misses an event

  After an append, each event is staged onto its fold, state projection, map,
  subscriber and process-manager inbox lanes. A lane that cannot be staged is
  recorded as one row per (lane, event) in the process store's outbox and
  re-driven from the event log with the outbox's backoff and dead letters.
  Nothing is added to the success path. See dev/docs/ARCHITECTURE.md §9.

  @unit
  Scenario: A successful hand-off writes nothing to the outbox
    Given a pipeline whose lanes all stage
    When an event is appended
    Then the hand-off outbox holds no row

  @unit
  Scenario: A subscriber that fails to stage is recorded and re-driven exactly once
    Given a subscriber whose first delivery throws
    When an event is appended
    Then the append succeeds
    And one hand-off row names the subscriber and the event
    When the hand-off outbox drains twice
    Then the subscriber has handled the event exactly once

  @unit
  Scenario: A process manager inbox that fails to stage is re-driven and commits once
    Given a process manager whose first inbox commit throws
    When an event is appended
    Then one hand-off row names the process manager's inbox
    When the hand-off outbox drains twice
    Then the process manager has evolved on the event exactly once

  @unit
  Scenario: A fold that fails to stage is recorded and never re-staged as a late event
    Given a fold whose first store throws
    When an event is appended
    Then one hand-off row names the fold and the event
    When the hand-off outbox drains
    Then the row retires dead naming the one-aggregate rebuild it needs
    And the fold is not handed the event again

  @unimplemented
  Scenario: A fold or state lane that missed an event rebuilds its aggregate
    Given a fold or state projection lane that missed an event
    When its hand-off row is re-driven
    Then the aggregate is rebuilt from the event log inside its own lane
    And an accumulating fold counts the event exactly once

  @unit
  Scenario: A global lane missed while the registry is closed is re-driven once it routes
    Given a global map projection on a registry that is not routing
    When an event is appended
    Then one hand-off row names the global lane
    When the registry routes again and the hand-off outbox drains twice
    Then the global lane is staged with the event exactly once

  @unit
  Scenario: A failed hand-off the outbox cannot record is counted as lost
    Given a subscriber whose delivery throws
    And a hand-off outbox that refuses the write
    When an event is appended
    Then the append succeeds
    And the loss is counted as unrecorded

  @unit
  Scenario: A crash replay of a command without a declared key collapses onto the first append
    Given a command handler that declares no event key
    When the same queue job runs the command twice
    Then both appends key their events on the job id and position
    And the event log's key collapses the second append onto the first

  @unit
  Scenario: A command's declared event key survives the crash replay unchanged
    Given a command handler that declares its own event key
    When the same queue job runs the command twice
    Then both appends carry the handler's key

  @unit
  Scenario: A coalesced batch keys each command's events on its own job
    Given two commands coalesced into one batch
    When the batch runs
    Then each command's events are keyed on its own job id

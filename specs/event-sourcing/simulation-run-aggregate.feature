@unit
Feature: The simulation_run aggregate, rewritten onto the new event-sourcing packages
  simulation-processing is the first pipeline greenfield-rewritten onto
  @langwatch/event-sourcing and @langwatch/clickhouse (ADR-098, ADR-099,
  ADR-100, ADR-103, ADR-105). The old implementation under
  event-sourcing.old/pipelines/simulation-processing fixed three defects the
  rewrite must not reintroduce: a cancelled run resurrected as a success by a
  late completion event, a dedup grouping wider than the table's engine key
  that collapses distinct rows, and a graceful shutdown that could leave an
  in-flight run's terminal write hanging. This file is the behavioural
  contract for the rewrite; it does not repeat the lifecycle scenarios
  specs/features/suites/simulation-run-status-consistency.feature already
  covers for the same fold logic, except where a scenario is specifically
  about one of the three defects.

  Background:
    Given the simulation_run pipeline's fold declared in simulationRunState.projection.ts

  # ---------------------------------------------------------------------------
  # Defect 1 — a cancelled run must never be resurrected as SUCCESS
  # ---------------------------------------------------------------------------

  Scenario: A cancel outranks a success that lands after it
    Given a run cancelled first
    When a success event for the same run is folded afterwards
    Then the run is still shown as cancelled

  Scenario: A cancel delivered after the success it overrode still wins
    Given a run whose success is folded first
    When a cancel event for the same run is folded afterwards
    Then the run is shown as cancelled

  Scenario: Two terminal declarations of equal authority keep the first
    Given a run that already finished successfully
    When a second success event for the same run is folded
    Then the run keeps the first success and its details

  Scenario: A genuine outcome supersedes a provisional stall
    Given a run the liveness process marked stalled
    When a real success event for the same run is folded afterwards
    Then the run is shown as successful, not stalled

  Scenario: A late start does not resurrect a cancelled run
    Given a run that was cancelled
    When its started event is delivered afterwards
    Then the run is still shown as cancelled

  # ---------------------------------------------------------------------------
  # Defect 2 — dedup grouping must not be wider than the engine key
  # ---------------------------------------------------------------------------

  Scenario: The fold's dispatch lane is scoped to one run, never a batch or set
    Given a fold group key built for one scenario run
    Then the key's scope names that run alone
    And nothing about the batch or the scenario set it belongs to appears in it

  Scenario: The batch aggregate query dedups on the table's own declared engine key
    Given the simulation_runs table's declared sort key
    When the batch aggregate query's dedup subquery is built
    Then it groups by exactly that sort key
    And it does not group by the batch id or the scenario set id

  Scenario: A batch id filter narrows the outer query, not the dedup subquery
    Given a request for one batch's aggregate totals
    When the query is built
    Then the batch id predicate appears outside the dedup subquery

  Scenario: One run's several stored versions count as a single row
    Given one run with two stored versions carrying different batch ids
    When the batch aggregate query is evaluated
    Then the run is counted in the batch its latest version belongs to
    And it is not counted twice

  # ---------------------------------------------------------------------------
  # Defect 3 — graceful shutdown settles in-flight runs
  # ---------------------------------------------------------------------------

  Scenario: Applying a command does not resolve before the run's state is durable
    Given a store whose write has not yet completed
    When a command is applied for a run
    Then the write has already been called before the command's promise resolves
    And the promise does not resolve until the write resolves

  Scenario: A failed durable write is not swallowed
    Given a store whose write rejects
    When a command is applied for a run
    Then applying the command rejects with the same failure
    And no state is reported as saved

  # ---------------------------------------------------------------------------
  # Order-invariance the fold's handlers rely on (ADR-098 decision 4)
  # ---------------------------------------------------------------------------

  Scenario: A late queue event does not put a finished run back in the queue
    Given a run that finished with an error
    When its queued event is delivered afterwards
    Then the run is still shown as failed rather than queued again

  Scenario: A redelivered message does not duplicate the run's transcript
    Given a message already recorded for a run
    When the same message is delivered again
    Then the run's transcript still shows that message once

  Scenario: A message that has only started carries no transcript row yet
    Given a message whose start was announced but whose content has not arrived
    When the run's transcript is read
    Then the message is absent rather than present and blank

  Scenario: A run measured under a retired event type keeps its cost on replay
    Given a run whose cost was recorded by a retired, unrecognised event type
    When that retired event is folded again
    Then the cost already on the state is kept rather than reset

  Scenario: A run's state is the same whatever order its events arrive in
    Given a run's whole event set
    When the events are folded in every order, and again with one delivered twice
    Then the run's state is the same every time

  # ---------------------------------------------------------------------------
  # ADR-103 — a run's totals are a query, not a counter
  # ---------------------------------------------------------------------------

  Scenario: Every run declares the batch total it was dispatched against
    Given a run queued as part of a five-run batch
    When the queued event is folded
    Then the run's state carries a batch total of five

  Scenario: A batch total established once is not erased by a later empty value
    Given a run whose batch total is already known
    When a redelivered queued event without a batch total is folded
    Then the run's batch total is unchanged

Feature: A queued scenario run is actually started
  As someone who pressed Run
  I want the run I queued to be picked up and executed exactly once
  So that it neither sits at "queued" forever nor runs twice at my expense

  # Bound via @scenario JSDoc against scenario-execution.deps.unit.test.ts and
  # simulation.clickhouse.repository.unit.test.ts.
  #
  # Context: queueing a run and running it are two different things. Queueing
  # writes an event; a durable process reads that event and hands the run to
  # the worker holding the child processes. That hand-off is the subject here.
  # What happens when a run then goes quiet is
  # scenario-execution-process-manager.feature; what a stalled run looks like
  # to a user is stalled-scenario-runs.feature.
  #
  # The hand-off is retried, because the message carrying it is durable and a
  # worker can die holding it. Retrying is only safe if a second attempt can
  # tell that the first one already reached the run — every scenario run spends
  # the customer's model budget, so "run it again to be sure" is the one
  # recovery that is never available. That is why the check below is against
  # what is durably stored about the run and nothing faster.

  Background:
    Given a scenario run that has been queued against a target

  # ============================================================================
  # Picking the run up
  # ============================================================================

  @unit
  Scenario: A queued run is handed to the executor
    When the run's dispatch is delivered
    Then the run is executed against its target
    And the executor is told which scenario, batch and set the run belongs to

  @unit
  Scenario: A run nothing is stored about yet is still executed
    Given nothing has been recorded about the run yet
    When the run's dispatch is delivered
    Then the run is executed rather than skipped

  # ============================================================================
  # Not running it twice
  # ============================================================================

  @unit
  Scenario: A run that is already under way is not started a second time
    Given the run has already started
    When the same dispatch is delivered again
    Then the run is not executed a second time

  @unit
  Scenario: A run that already finished is not started again
    Given the run has already finished
    When the same dispatch is delivered again
    Then the run is not executed a second time

  # Whether the run has already been reached is a question only the durable
  # record can answer. Anything faster is allowed to be behind, and being
  # behind here means answering "still queued" for a run that is already
  # spending money — the one wrong answer that costs the customer twice.
  @unit
  Scenario: Whether the run already started is read from the durable record
    Given the run has already started
    When the same dispatch is delivered again
    Then the answer comes from the run's stored record, not from a cache

  @unit
  Scenario: A run archived after it ran is still recognised as already run
    Given the run finished and was later archived
    When the same dispatch is delivered again
    Then the run is not executed a second time

  # ============================================================================
  # When the run cannot be executed
  # ============================================================================

  @unit
  Scenario: A fault while starting the run is recorded against it
    Given the run cannot be handed to the executor
    When the run's dispatch is delivered
    Then the run is recorded as failed rather than left queued

  @unit
  Scenario: A recorded failure carries the scenario's name and description
    Given the run cannot be handed to the executor
    When the run's dispatch is delivered
    Then the recorded failure reads like any other run in the list

  @unit
  Scenario: A run whose scenario can no longer be looked up is still ended
    Given the scenario the run belongs to can no longer be read
    When the run is recorded as failed
    Then the run still reaches a terminal state
    And it is listed without the scenario's name rather than not listed at all

  @unit
  Scenario: A run the user cancelled is recorded as cancelled, not as an error
    Given the user asked to cancel the run
    When the run is recorded as ended
    Then it is recorded as cancelled

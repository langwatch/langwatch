Feature: A scenario run always reaches a terminal state
  As someone running scenarios
  I want a run whose worker dies to be recorded as finished anyway
  So that a batch never sits at "in progress" waiting for a machine that is gone

  # Bound via @scenario JSDoc against scenarioExecution.process.unit.test.ts.
  #
  # Context: a scenario run reports its own progress, and its last report is
  # normally "finished". When the worker holding the child process is killed,
  # OOMed or redeployed, that last report never comes and the run stays
  # non-terminal.
  #
  # This was previously reconstructed by two cross-tenant sweeps that ran only
  # at worker boot, so how quickly a run recovered depended on how often we
  # deployed — a run abandoned an hour after a restart waited for the next one.
  # A durable process now holds it continuously: the run's own progress events
  # are the heartbeat, so a run that keeps talking pushes its own deadline out,
  # and a run that goes quiet has a deadline fire against it. (ADR-073, step 1.)
  #
  # Distinct from stalled-scenario-runs.feature, which derives a STALLED status
  # at read time and does not write anything. This feature is about the durable
  # write that ends the run for good.

  Background:
    Given a scenario run belonging to a batch

  # ============================================================================
  # Staying alive
  # ============================================================================

  @unit
  Scenario: A run that keeps reporting is left alone
    Given the run has started
    When it keeps reporting progress
    Then it is not declared dead
    And each report extends how long it may go quiet

  @unit
  Scenario: A queued run is given time to be picked up
    Given the run has been queued but not started
    When no worker has picked it up yet
    Then it is not declared dead before the dispatch window elapses

  @unit
  Scenario: A backlog does not kill a healthy run
    Given progress reports are being delivered later than they occurred
    When a report arrives describing a moment already past
    Then the run's remaining quiet time is measured from now
    And a healthy run is not declared dead because of the delay

  # ============================================================================
  # Being declared dead
  # ============================================================================

  @unit
  Scenario: A run whose worker disappears is recorded as failed
    Given the run has started
    When nothing reports on it for longer than it is allowed to stay quiet
    Then the run is recorded as failed
    And the reason says the worker executing it is no longer alive

  @unit
  Scenario: A cancelled run nobody honoured is still ended
    Given the user asked to cancel the run
    When no worker reports it finished within the cancellation grace
    Then the run is recorded as cancelled rather than failed

  @unit
  Scenario: A reaped run reads like any other in the list
    Given the run is recorded as failed because its worker disappeared
    When the run is displayed
    Then it carries the scenario's name and description

  # ============================================================================
  # Not being declared dead twice
  # ============================================================================

  @unit
  Scenario: A run that finished on its own is never reaped
    Given the run reported that it finished
    When its deadline would otherwise have fired
    Then nothing further is recorded against it

  @unit
  Scenario: A late report cannot revive a finished run
    Given the run reported that it finished
    When a straggling progress report arrives afterwards
    Then the run is not put back under watch
    And it is not later recorded as failed

  @unit
  Scenario: A deleted run stops being watched
    Given the run was deleted
    When its deadline would otherwise have fired
    Then nothing further is recorded against it

  @unit
  Scenario: Recording the death twice records it once
    Given the run has been declared dead
    When the recording is retried
    Then the run has one terminal outcome, not two

  # ============================================================================
  # Giving up safely
  # ============================================================================

  @unit
  Scenario: A run nothing is known about is abandoned rather than retried forever
    Given no report has said which scenario or batch the run belongs to
    When its deadline fires
    Then nothing is recorded against it
    And it is not re-examined on every later sweep

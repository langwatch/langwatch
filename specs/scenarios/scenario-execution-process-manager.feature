Feature: A scenario run always reaches a terminal state
  As someone running scenarios
  I want a run whose worker dies to be recorded as finished anyway
  So that a batch never sits at "in progress" waiting for a machine that is gone

  # Bound via @scenario JSDoc against scenarioExecution.process.unit.test.ts
  # (the deadline) and scenario-processor-shutdown.unit.test.ts (the shutdown).
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
  # The deadline is the guarantee; it is not the whole story. A deploy is the
  # common case, not the rare one, and on a deploy the worker knows exactly
  # which runs it is about to abandon. Waiting out a ~30-minute deadline for
  # something the worker could write in a second is a regression the deadline
  # hides rather than fixes, so the last section below keeps the shutdown
  # settling what it holds. (ADR-073, "Deleting the drain costs deploy
  # latency".)
  #
  # STALLED as a status is written, never derived: see
  # stalled-scenario-runs.feature for what a user sees, and this file for the
  # durable write that ends the run for good.

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
  Scenario: A run waiting behind a big batch is not mistaken for a dead one
    Given the run was queued as one of many in the same batch
    When it waits its turn behind the others
    Then it is given more time to be picked up than a run queued on its own
    And it is not declared dead for waiting

  @unit
  Scenario: A backlog does not kill a healthy run
    Given progress reports are being delivered later than they occurred
    When a report arrives describing a moment already past
    Then the run keeps its full allowance of quiet time from that report
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
    And it never reappears as a result

  # Only the run's first two events name the scenario; every later one names the
  # batch and the set and nothing else. A run that reports progress without ever
  # having reported a start therefore knows where it belongs but not what it is,
  # and that is not a reason to leave it running forever — the scenario's name is
  # decoration on the result, not what identifies the run.
  @unit
  Scenario: A run known only from its progress reports is still ended
    Given the reports on the run said which batch it belongs to but never which scenario
    When its deadline fires
    Then the run is recorded as failed
    And it is listed without the scenario's name rather than not listed at all

  # ============================================================================
  # Being redeployed
  # ============================================================================
  # A deploy is the most common way a run loses its worker, and the only one
  # where the worker gets to say goodbye. It knows which runs it holds, so it
  # ends them itself instead of leaving each one to sit non-terminal until its
  # deadline comes round.

  @unit
  Scenario: A run whose worker is redeployed is recorded before the worker exits
    Given the run is executing on this worker
    When the worker is asked to shut down
    Then the run is recorded as finished before the shutdown completes
    And nobody has to wait out its deadline to learn that

  @unit
  Scenario: A run cancelled before the shutdown is recorded as cancelled
    Given the user asked to cancel the run
    And it is still executing on this worker
    When the worker is asked to shut down
    Then the run is recorded as cancelled rather than failed

  @unit
  Scenario: One run that cannot be recorded does not strand the others
    Given several runs are executing on this worker
    And recording one of them fails
    When the worker is asked to shut down
    Then the remaining runs are still recorded

  @unit
  Scenario: A shutdown is not held open by a run that will not settle
    Given a run whose terminal record never completes
    When the worker is asked to shut down
    Then the shutdown finishes within its own time budget
    And that run is left to its deadline

Feature: Experiment runs always reach a terminal state
  An experiment run is watched by a durable process for as long as it is
  producing results. If the work behind it disappears, the run stops being
  reported as running instead of staying started forever. (ADR-073.)

  # CORRECTION (2026-07-28). The first draft of this file asked for a terminal
  # state the domain cannot express. `experimentRunCompletedEventDataSchema`
  # models exactly two fields — `finishedAt` and `stoppedAt` — the
  # `experiment_runs` table has no failure or reason column, and every reader
  # derives "terminal" from `finishedAt ?? stoppedAt`. There is no *failed*
  # experiment run. Scenarios now say "stops being reported as running", which
  # is what the platform can honestly deliver: a reaped run is written as
  # STOPPED, never FINISHED, because presenting a partial result set as a
  # complete one is worse than presenting it as cut short.
  #
  # Giving the reason a durable home — an additive optional field on the
  # completed event plus a stored column — is the same move ADR-073 step 2
  # makes for simulations, and belongs with it rather than here.
  #
  # Dispatch scenarios have moved out. "Executes on the fleet" cannot be
  # delivered in the shape this file implied: ADR-081 establishes that the
  # leasable unit is a slice of cells and that a per-cell time cap is its
  # precondition. Liveness does not need that and does not wait for it.

  Background:
    Given an experiment with a dataset and evaluators

  # ============================================================================
  # Staying alive
  # ============================================================================

  @unit
  Scenario: Results keep a running experiment alive
    Given an experiment run that is producing results
    When it keeps producing results for longer than the silence allowed
    Then it is not ended for inactivity
    And each result extends how long it may go quiet

  @unit
  Scenario: A backlog does not end a healthy run
    Given results are being recorded later than they occurred
    When a result arrives describing a moment already past
    Then the run's remaining quiet time is measured from now
    And a healthy run is not ended because of the delay

  # ============================================================================
  # Being ended
  # ============================================================================

  @unit
  Scenario: An experiment run whose work disappears is ended
    Given an experiment run that has started
    When the work behind it stops producing results and never completes
    Then the run stops being reported as running
    And it is reported as cut short rather than as having completed

  @unit
  Scenario: Ending a run stops it spending
    Given an experiment run that is ended for inactivity
    When the platform records the outcome
    Then the work is signalled to stop first
    So that a run ended in error cannot keep costing the customer money

  @unit
  Scenario: A stop that is never observed still ends the run
    Given an experiment run whose work cannot be signalled
    When the user stops it
    Then the run still reaches a terminal state

  # ============================================================================
  # Not being ended twice
  # ============================================================================

  @unit
  Scenario: A completed run stops being watched
    Given an experiment run that completes normally
    When its completion is recorded
    Then no further deadline is armed for it
    And it is not ended afterwards for inactivity

  @unit
  Scenario: A late result cannot revive a completed run
    Given an experiment run that has completed
    When a straggling result arrives afterwards
    Then the run is not put back under watch

  @unit
  Scenario: Recording the outcome twice records it once
    Given an experiment run that has been ended
    When the recording is retried
    Then the run has one terminal outcome, not two

  @unit
  Scenario: A run nothing is known about is abandoned rather than retried forever
    Given no result has said which experiment the run belongs to
    When its deadline fires
    Then nothing is recorded against it
    And it is not re-examined on every later sweep

  # ============================================================================
  # What the watch costs
  # ============================================================================
  #
  # Experiment-run events carry the customer's dataset rows, the model's
  # outputs, evaluator inputs and free-text errors. Watching a run must not
  # copy any of that into the platform's own bookkeeping.

  @unit
  Scenario: Watching a run does not copy what the run is about
    Given an experiment run whose results carry dataset rows and model outputs
    When the platform watches the run for liveness
    Then only the identities needed to find the run again are kept
    And no dataset row, model output or evaluator input is copied into them

  # ============================================================================
  # Reading a run back
  # ============================================================================

  @integration @unimplemented
  Scenario: Recovery does not depend on a cached progress record
    Given an experiment run whose cached progress has expired
    When the run is read
    Then its outcome is still reported

  # ============================================================================
  # Known gaps — specified so they are not mistaken for working behaviour
  # ============================================================================

  @unimplemented
  Scenario: Stopping a run ends it promptly
    Given an experiment run that is executing
    When the user stops it
    Then the run reaches a terminal state without waiting out the silence window
    # Not built: the abort route raises a flag and emits no event, so the
    # watching process cannot tell "quiet because stopped" from "quiet because
    # dead" and can only fall back on the ordinary silence window. Closing this
    # needs a stop-requested event, which is additive but not liveness-only.

  @unimplemented
  Scenario: An interactive run with no experiment behind it is still watched
    Given an interactive run started from the workbench with no experiment
    When the process running it is lost
    Then the run stops being reported as running
    # Not built, and not fixable by a watching process alone: an experiment is
    # optional on this path and every record of progress is skipped without
    # one, so the run produces nothing to watch. It needs an identity of its
    # own before anything can recover it.

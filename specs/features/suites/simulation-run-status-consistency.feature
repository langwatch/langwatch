Feature: A simulation run's terminal status survives whatever arrives after it
  A run's events do not arrive in the order they happened. A measurement is
  taken a minute after the run settles; a late `started` can follow the
  `finished` it preceded; a cancel can be delivered after the success it
  overrode. None of that may move a run back out of the state the user was
  shown, and none of it may blank a value the run already displays.

  # REWRITTEN. Both original scenarios were written against
  # `lw.simulation_run.metrics_computed` — a per-trace event retired on
  # 2026-03-27 and no longer in the fold's handled-event list. As written they
  # asserted that a live `metrics_computed` event "is applied correctly", which
  # is false today: the fold drops it. The behaviour they were protecting — a
  # late measurement never reverting a terminal status — is real, still
  # matters, and is now expressed against the run-level `metrics_recorded`
  # event that replaced it.
  #
  # The retired event survives in exactly one place below: rows written before
  # the retirement still replay through the fold, and that path gets its own
  # scenario rather than being pretended away.

  Background:
    Given a simulation run folded from its event log

  # --- A measurement never moves the run backwards ---

  @unit
  Scenario: A measurement taken after the run finished leaves its status alone
    Given a run that started, reported messages, and finished successfully
    When its metrics are recorded afterwards
    Then the run is still successful
    And the recorded cost is shown against it

  @unit
  Scenario: A measurement that overtakes the lifecycle does not pre-empt it
    Given a run whose metrics are recorded before its snapshot and finish arrive
    When the events are folded
    Then the run still ends successful
    And the metrics are not lost by the events that followed them

  @unit
  Scenario: Every arrival order of a run's lifecycle converges on the same result
    Given the queued, started, finished and metrics events for one successful run
    When they are folded in every possible order
    Then the run is successful in each case
    And it carries a finish time in each case

  # --- Measuring twice ---

  @unit
  Scenario: A second measurement replaces the first rather than adding to it
    Given a run already measured once
    When it is measured again with different values
    Then the later values are the ones shown

  @unit
  Scenario: Re-measuring does not compound the per-role values
    Given a run already measured once
    When it is measured again
    Then each role still carries one value per trace, not two

  # --- The retired per-trace event ---

  @unit
  Scenario: A run measured under the retired per-trace event keeps its cost on replay
    Given a run whose cost was recorded by the retired per-trace measurement
    When an event that occurred before that checkpoint is folded on top
    Then the cost already on the row is kept rather than rebuilt as blank

  @unit
  Scenario: An event older than the checkpoint is still applied to the state that was loaded
    Given a run restored from its stored state
    When an event that occurred before the checkpoint arrives
    Then it is applied on top of the loaded state rather than dropped

  # --- Late lifecycle events ---

  @unit
  Scenario: A late start does not resurrect a run that already failed
    Given a run that finished with an error
    When its started event is delivered afterwards
    Then the run is still shown as failed

  @unit
  Scenario: A late start does not unsettle a run that already succeeded
    Given a run that finished successfully
    When its started event is delivered afterwards
    Then the run is still shown as successful

  @unit
  Scenario: A late start does not cost the run the details the other events carried
    Given a run whose events arrive out of order
    When they are folded
    Then the metadata from every event is still present

  @unit
  Scenario: A late queue event does not put a finished run back in the queue
    Given a run that finished with an error
    When its queued event is delivered afterwards
    Then the run is still shown as failed rather than queued again

  @unit
  Scenario: A cancel delivered after the success it overrode still wins
    Given a run cancelled before a success was reported for it
    When the success is delivered first and the cancel second
    Then the run is shown as cancelled

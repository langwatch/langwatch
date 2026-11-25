Feature: Orphaned scenario run recovery

  When the scenarios worker that is executing a run dies mid-flight (OOM,
  crash, deploy, or container restart), the run never receives its terminal
  `finished` event. The in-process execution pool that would emit a failure
  event dies with the worker, so without recovery the run would be left
  non-terminal in ClickHouse — the UI spinning at "Starting"/"Running" and
  downstream subscribers (suite aggregates, metrics) never firing.

  Recovery is owned by the simulation_run_execution process manager
  (ADR-094): every run has a per-run process instance whose stall watchdog
  wake force-finishes the run ERROR "stalled" once it has been quiet past
  STALL_THRESHOLD_MS — a recorded terminal event, so the run leaves the
  in-flight state for good and downstream subscribers fire.

  Runs started BEFORE the process manager existed have no process instance,
  so no watchdog covers them: they may remain non-terminal. That is an
  accepted deployment-window loss — the legacy boot-time reconciliation sweep
  (orphaned-run-reconciliation.ts) that used to close that gap was deleted
  outright rather than kept for a deprecation cycle.

  Because recovery finishes runs through the ordinary event path, the fold
  projection's terminal-state invariants remain the last line of defence: a
  run that reached a terminal state must stay terminal no matter what late
  events arrive.

  Background:
    Given scenario runs are processed via the simulation-processing pipeline
    And scenario runs are stored in ClickHouse

  # ---------------------------------------------------------------------------
  # The terminal state a finished run lands in must be final
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A late child cannot overwrite the terminal state of a finished run
    Given a run that was finished with a terminal error state
    When its child process outlives the worker and reports that it finished
    Then the run keeps the terminal state it was finished with

  @unit
  Scenario: A finished run can never be left in a non-terminal state
    Given a client reports a run as finished but names a non-terminal status
    When the run state is folded
    Then the run is recorded with a terminal status

  @unit
  Scenario: A run re-entering the queue cannot revive a finished run
    Given a run that already reached a terminal state
    When a later event announces the run as queued for execution
    Then the run keeps its terminal state

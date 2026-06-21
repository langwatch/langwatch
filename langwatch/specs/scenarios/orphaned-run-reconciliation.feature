Feature: Orphaned scenario run reconciliation on worker boot

  When the scenarios worker that is executing a run dies mid-flight (OOM,
  crash, deploy, or container restart), the run never receives its terminal
  `finished` event. The in-process execution pool that would emit a failure
  event dies with the worker, so the run is left non-terminal in ClickHouse —
  the UI shows it spinning at "Starting"/"Running" with no indication that no
  worker is processing it. Read-time stall detection eventually paints it as
  "stalled", but it never becomes terminal in the event log, so downstream
  reactors (suite aggregates, metrics) never run.

  To close this gap, every scenarios worker reconciles orphaned runs when it
  boots: it looks for non-terminal runs whose last activity is older than a
  live worker could possibly still be holding them, and emits a terminal
  failure event so they leave the in-flight state for good.

  A run is considered orphaned only when enough time has passed that no live
  worker could still be processing it — a worker hard-caps every execution and
  would have emitted its own terminal event by then. This guarantees a healthy
  run owned by another live worker is never reconciled out from under it.

  Background:
    Given scenario runs are processed via the simulation-processing pipeline
    And scenario runs are stored in ClickHouse

  # ---------------------------------------------------------------------------
  # Reconciliation decision (orphaned vs healthy)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A run orphaned at STARTING is reconciled to a terminal failed state
    Given a scenario run queued for execution
    And its worker died before emitting any further event
    And its last activity is older than the reconciliation threshold
    When a scenarios worker boots and reconciles orphaned runs
    Then the run is moved to a terminal error state
    And the error explains the worker restarted before the run completed

  @unit
  Scenario: A healthy in-flight run is not reconciled
    Given a scenario run that is actively in progress
    And its last activity is more recent than the reconciliation threshold
    When a scenarios worker boots and reconciles orphaned runs
    Then the run is left untouched

  @unit
  Scenario: An already-terminal run is not reconciled again
    Given a scenario run that already finished
    When a scenarios worker boots and reconciles orphaned runs
    Then no terminal event is emitted for that run

  @unit
  Scenario: Reconciling one run does not stop the others
    Given several orphaned scenario runs
    And emitting the terminal event for one of them fails
    When a scenarios worker boots and reconciles orphaned runs
    Then the remaining orphaned runs are still reconciled

  # ---------------------------------------------------------------------------
  # ClickHouse query — which runs are surfaced as orphaned
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Only stale non-terminal runs are surfaced as orphaned
    Given a non-terminal run whose last activity is beyond the threshold
    And a non-terminal run whose last activity is within the threshold
    And a terminal run whose last activity is beyond the threshold
    And an archived run whose last activity is beyond the threshold
    When the orphaned-run query runs
    Then only the stale non-terminal run is returned
    And it carries the tenant, scenario, batch and set ids needed to finish it

  @integration
  Scenario: The latest version of a run decides whether it is orphaned
    Given a run that was queued long ago and later finished successfully
    When the orphaned-run query runs
    Then the run is not surfaced as orphaned

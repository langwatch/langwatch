Feature: Event-driven scenario execution
  As the scenario execution system
  I need scenario runs to be fully event-driven
  So that queueing, execution, and cancellation use a single event-sourcing architecture

  # Per AUDIT_MANIFEST.md: 11 scenarios → 7 DUPLICATE (already bound via
  # @scenario JSDoc against cancellation-eligibility.unit.test.ts,
  # simulation-runner.router.unit.test.ts, execution-pool.unit.test.ts) +
  # 4 KEEP. The 4 KEEP scenarios remain @unimplemented pending integration test
  # coverage for suite-level queueRun fan-out, the process manager's execute
  # intent on queued/cancelled, and 6-pod GroupQueue distribution — tracked in
  # PR #3458.
  #
  # Migration note (ADR-094): the fire-and-forget scenarioExecution reactor was
  # replaced by the durable simulation_run_execution process manager. A queued
  # event now evolves per-run PM state and emits an `execute` intent through
  # the leased PG outbox (retried, never silently dropped); the intent handler
  # submits the job to the execution pool.

  Background:
    Given the event-sourcing pipeline is active

  # ============================================================================
  # 1. QUEUED status lifecycle
  # ============================================================================

  # ============================================================================
  # 2. Ad-hoc and suite runs dispatch queueRun command
  # ============================================================================

  @integration @unimplemented
  Scenario: Suite run dispatches queueRun for each scenario
    Given a suite has 3 scenarios and 2 targets
    When the user starts a suite run
    Then 6 queueRun commands are dispatched (3 scenarios × 2 targets)
    And each has a unique pre-generated scenarioRunId

  # ============================================================================
  # 3. Process manager dispatches queued runs to the execution pool
  # ============================================================================

  @unit
  Scenario: Process manager dispatches execute intent on queued event
    Given the simulation_run_execution process manager is registered on the simulation pipeline
    When a queued event is processed by the GroupQueue
    Then the process manager emits an execute intent via the durable outbox
    And the intent handler submits the job to the execution pool

  @unit
  Scenario: Process manager skips already-cancelled runs
    Given a scenario run has CancellationRequestedAt set in the fold projection
    When a queued event for that run is processed
    Then the process manager does not submit the job to the execution pool
    And the run is finished with status CANCELLED

  # ============================================================================
  # 4. Execution pool manages concurrency
  # ============================================================================

  # ============================================================================
  # 5. Distribution across worker pods
  # ============================================================================

  @integration @unimplemented
  Scenario: GroupQueue distributes queued events across workers
    Given 6 worker pods are running
    When 18 scenarios are queued in a suite run
    Then queued events are distributed across the 6 workers
    And each worker's execute intent handler fires for its assigned scenarios


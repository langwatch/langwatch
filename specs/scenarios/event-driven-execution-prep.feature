Feature: Event-driven scenario execution
  As the scenario execution system
  I need scenario runs to be fully event-driven
  So that queueing, execution, and cancellation use a single event-sourcing architecture

  Background:
    Given the event-sourcing pipeline is active

  # ============================================================================
  # 1. QUEUED status lifecycle
  # ============================================================================

  @unit
  Scenario: QUEUED runs can be cancelled
    Given a scenario run is in QUEUED status
    When the system checks whether the run is cancellable
    Then the run is eligible for cancellation

  @unit
  Scenario: Terminal statuses remain non-cancellable
    Given a scenario run is in SUCCESS status
    When the system checks whether the run is cancellable
    Then the run is not eligible for cancellation

  # ============================================================================
  # 2. Ad-hoc and suite runs dispatch queueRun command
  # ============================================================================

  @integration
  Scenario: Ad-hoc run dispatches queueRun command
    Given a user triggers an ad-hoc scenario run from the UI
    When the simulation runner processes the request
    Then a queueRun command is dispatched with the scenario metadata
    And the QUEUED state is written to ClickHouse

  @integration
  Scenario: Suite run dispatches queueRun for each scenario
    Given a suite has 3 scenarios and 2 targets
    When the user starts a suite run
    Then 6 queueRun commands are dispatched (3 scenarios × 2 targets)
    And each has a unique pre-generated scenarioRunId

  # ============================================================================
  # 3. Execution reactor picks up queued events
  # ============================================================================

  @integration
  Scenario: Execution reactor fires on queued event
    Given the execution reactor is registered on the simulation pipeline
    When a queued event is processed by the GroupQueue
    Then the reactor submits the job to the execution pool

  @integration
  Scenario: Execution reactor skips already-cancelled runs
    Given a scenario run has CancellationRequestedAt set in the fold projection
    When a queued event for that run is processed
    Then the reactor does not submit the job to the execution pool

  # ============================================================================
  # 4. Execution pool manages concurrency
  # ============================================================================

  @unit
  Scenario: Pool starts child process when capacity is available
    Given the execution pool has concurrency 3
    And 2 scenarios are currently running
    When a new job is submitted to the pool
    Then the pool spawns a child process immediately

  @unit
  Scenario: Pool buffers jobs when at capacity
    Given the execution pool has concurrency 3
    And 3 scenarios are currently running
    When a new job is submitted to the pool
    Then the job is added to the pending queue
    And no child process is spawned yet

  @unit
  Scenario: Pool dequeues pending jobs when a slot opens
    Given the execution pool is at capacity with 1 pending job
    When a running child process exits
    Then the pending job is dequeued and spawned immediately

  # ============================================================================
  # 5. Distribution across worker pods
  # ============================================================================

  @integration
  Scenario: GroupQueue distributes queued events across workers
    Given 6 worker pods are running
    When 18 scenarios are queued in a suite run
    Then queued events are distributed across the 6 workers
    And each worker's execution reactor fires for its assigned scenarios

  @integration
  Scenario: Each worker respects its local concurrency limit
    Given a worker pod has concurrency 3
    And 10 queued events are assigned to this worker
    Then at most 3 child processes run concurrently
    And the remaining 7 are buffered in the pending queue

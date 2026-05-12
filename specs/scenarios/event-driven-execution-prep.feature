Feature: Event-driven scenario execution
  As the scenario execution system
  I need scenario runs to be fully event-driven
  So that queueing, execution, and cancellation use a single event-sourcing architecture

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
  # 3. Execution reactor picks up queued events
  # ============================================================================

  @integration @unimplemented
  Scenario: Execution reactor fires on queued event
    Given the execution reactor is registered on the simulation pipeline
    When a queued event is processed by the GroupQueue
    Then the reactor submits the job to the execution pool

  @integration @unimplemented
  Scenario: Execution reactor skips already-cancelled runs
    Given a scenario run has CancellationRequestedAt set in the fold projection
    When a queued event for that run is processed
    Then the reactor does not submit the job to the execution pool

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
    And each worker's execution reactor fires for its assigned scenarios


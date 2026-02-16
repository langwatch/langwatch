Feature: Scenario Job ID Uniqueness
  As the scenario scheduling system
  I need unique job IDs for each distinct execution
  So that BullMQ does not silently deduplicate jobs in multi-target or repeated runs

  # Context: scheduleScenarioRun() generates job IDs used by BullMQ for deduplication.
  # The current formula `scenario_${projectId}_${scenarioId}_${batchRunId}` omits
  # the target and repeat index, causing jobs to collide when the same scenario
  # runs against multiple targets or with repeats in the same batch.
  #
  # Fix: include target referenceId and a unique index in the job ID.

  # ============================================================================
  # Multi-Target: distinct jobs per target
  # ============================================================================

  @unit
  Scenario: Scheduling same scenario against two different targets produces distinct job IDs
    Given scenario "Refund Flow" in project "proj_1" with batch "batch_1"
    When the scenario is scheduled against target "prompt_A"
    And the scenario is scheduled against target "prompt_B"
    Then the two jobs have different IDs

  @unit
  Scenario: Job ID includes target reference ID
    Given scenario "Refund Flow" in project "proj_1" with batch "batch_1"
    When the scenario is scheduled against target "prompt_A"
    Then the job ID contains "prompt_A"

  # ============================================================================
  # Repeated Runs: distinct jobs per repeat
  # ============================================================================

  @unit
  Scenario: Scheduling same scenario three times in one batch produces three distinct job IDs
    Given scenario "Refund Flow" in project "proj_1" with batch "batch_1" and target "prompt_A"
    When the scenario is scheduled 3 times
    Then all 3 jobs have different IDs

  # ============================================================================
  # Combined: multi-target with repeats
  # ============================================================================

  @unit
  Scenario: Running scenario against two targets with repeat=2 produces four distinct jobs
    Given scenario "Refund Flow" exists in project "proj_1"
    And targets "prompt_A" and "prompt_B" are configured
    When the scenario is scheduled against both targets with 2 repeats each
    Then 4 jobs are created
    And all 4 jobs have unique IDs

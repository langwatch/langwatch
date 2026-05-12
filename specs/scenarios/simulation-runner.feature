Feature: Simulation Runner Service
  As the SimulationRunnerService
  I need to orchestrate scenario execution
  So that scenarios can be run against various targets

  # ============================================================================
  # Initialization
  # ============================================================================

  @unit @unimplemented
  Scenario: Load scenario and prompt for execution
    Given scenario "Test" exists
    And prompt "Test Prompt" exists
    When SimulationRunnerService.run is called
    Then the scenario is loaded from ScenarioService
    And the prompt is loaded from PromptService
    And the SDK scenario.run is invoked

  @unit @unimplemented
  Scenario: Load scenario and HTTP agent for execution
    Given scenario "Test" exists
    And HTTP agent "Test Agent" exists with URL "https://api.example.com"
    When SimulationRunnerService.run is called
    Then the scenario is loaded from ScenarioService
    And the HTTP adapter is configured with the agent URL

  # ============================================================================
  # SDK Integration
  # ============================================================================

  @unit @unimplemented
  Scenario: Pass situation to SDK
    Given scenario with situation "User is angry about billing"
    When SimulationRunnerService executes
    Then the SDK receives the situation in the description

  @unit @unimplemented
  Scenario: Pass criteria to SDK for judgment
    Given scenario with criteria ["Must apologize", "Must offer refund"]
    When SimulationRunnerService executes
    Then the SDK receives the criteria for judge evaluation

  @unit @unimplemented
  Scenario: Pass labels to SDK for tracing
    Given scenario with labels ["support", "billing"]
    When SimulationRunnerService executes
    Then the SDK receives the labels as metadata

  # ============================================================================
  # Target Adapters
  # ============================================================================

  # ============================================================================
  # Event Emission
  # ============================================================================

  @unit @unimplemented
  Scenario: Emit run finished event with results
    When a scenario run completes
    Then a "run_finished" event is emitted
    And the event includes pass/fail for each criterion

  # ============================================================================
  # Event-Driven Execution with OTEL Isolation
  # ============================================================================
  # Scenario execution is fully event-driven:
  # 1. API dispatches queueRun command → queued event
  # 2. Execution reactor picks up the event → submits to execution pool
  # 3. Pool spawns an isolated child process
  # No BullMQ is used — the event-sourcing GroupQueue distributes work.

  # ============================================================================
  # Error Handling - Early Validation (API Level)
  # ============================================================================
  # These errors are returned immediately from the API before scheduling a job.
  # This provides instant feedback to the frontend instead of async job failures.

  @unit @unimplemented
  Scenario: Return immediate error when prompt has no model configured
    Given prompt "Test" exists without a model configured
    And project has no default model configured
    When the run scenario API is called with prompt target
    Then it returns an immediate error (not scheduled)
    And the error message contains "does not have a model configured"

  # ============================================================================
  # Error Handling - Worker Level (Safety Net)
  # ============================================================================
  # These errors occur in the worker if data changes after validation passed.
  # They serve as a safety net but should rarely happen in practice.

  @integration @unimplemented
  Scenario: Return error when HTTP agent not found
    Given scenario "Test" exists
    And HTTP agent "nonexistent" does not exist
    When SimulationRunnerService.execute is called with HTTP target
    Then it returns an error result
    And the error message contains "HTTP agent" and "not found"

  @integration @unimplemented
  Scenario: Return error when model provider disabled
    Given scenario "Test" exists
    And the project's model provider is disabled
    When SimulationRunnerService.execute is called
    Then it returns an error result
    And the error message contains "not configured or disabled"

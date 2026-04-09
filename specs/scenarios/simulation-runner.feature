Feature: Simulation Runner Service
  As the SimulationRunnerService
  I need to orchestrate scenario execution
  So that scenarios can be run against various targets

  # ============================================================================
  # Initialization
  # ============================================================================

  @unit
  Scenario: Load scenario and prompt for execution
    Given scenario "Test" exists
    And prompt "Test Prompt" exists
    When SimulationRunnerService.run is called
    Then the scenario is loaded from ScenarioService
    And the prompt is loaded from PromptService
    And the SDK scenario.run is invoked

  @unit
  Scenario: Load scenario and HTTP agent for execution
    Given scenario "Test" exists
    And HTTP agent "Test Agent" exists with URL "https://api.example.com"
    When SimulationRunnerService.run is called
    Then the scenario is loaded from ScenarioService
    And the HTTP adapter is configured with the agent URL

  # ============================================================================
  # SDK Integration
  # ============================================================================

  @unit
  Scenario: Pass situation to SDK
    Given scenario with situation "User is angry about billing"
    When SimulationRunnerService executes
    Then the SDK receives the situation in the description

  @unit
  Scenario: Pass criteria to SDK for judgment
    Given scenario with criteria ["Must apologize", "Must offer refund"]
    When SimulationRunnerService executes
    Then the SDK receives the criteria for judge evaluation

  @unit
  Scenario: Pass labels to SDK for tracing
    Given scenario with labels ["support", "billing"]
    When SimulationRunnerService executes
    Then the SDK receives the labels as metadata

  # ============================================================================
  # Target Adapters
  # ============================================================================

  @unit
  Scenario: HTTP adapter sends request to endpoint
    Given HTTP target configured with:
      | url    | https://api.example.com/chat |
      | method | POST                         |
      | auth   | bearer                       |
    When the adapter receives a message
    Then it sends a POST request to the URL
    And includes the bearer token in headers

  @unit
  Scenario: Prompt adapter uses prompt configuration
    Given prompt "Support Agent" with:
      | model       | gpt-4       |
      | temperature | 0.7         |
      | system      | Be helpful. |
    When the adapter receives a message
    Then it calls the model with the prompt configuration

  # ============================================================================
  # Event Emission
  # ============================================================================

  @unit
  Scenario: Emit run started event
    When a scenario run begins
    Then a "run_started" event is emitted
    And the event includes runId, scenarioId, targetId

  @unit
  Scenario: Emit message events during conversation
    When the simulator or target sends a message
    Then a "message_snapshot" event is emitted
    And the event includes the message content and role

  @unit
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

  @integration
  Scenario: Execute scenario in isolated child process via execution reactor
    Given scenario "Test" exists with criteria
    And prompt "Test Prompt" is configured as target
    When a queued event is processed by the execution reactor
    Then the execution pool spawns an isolated child process
    And the child receives serialized scenario data

  @integration
  Scenario: Child process has isolated OTEL context
    Given a scenario run is started via the execution pool
    When the child process initializes
    Then it creates its own OTEL TracerProvider
    And the provider exports to LangWatch endpoint
    And traces are not mixed with server global telemetry

  @integration
  Scenario: Child traces include scenario metadata
    Given scenario "Refund Test" with labels ["support", "billing"]
    When the scenario executes in a child process
    Then exported traces include scenarioId as resource attribute
    And exported traces include batchRunId as resource attribute

  @integration
  Scenario: Child events include scenario set ID
    Given scenario "Refund Test" in set "production-tests"
    When the scenario executes in a child process
    Then emitted events include scenarioSetId "production-tests"
    And the events are NOT stored in the default set

  @integration
  Scenario: OTEL context is cleaned up after child execution
    Given a scenario run completes in a child process
    When the child process finishes
    Then the TracerProvider is shut down
    And pending spans are flushed before termination

  @integration
  Scenario: Execution pool reports success to failure handler
    Given a scenario run completes successfully
    When the child process exits with code 0
    Then the execution pool logs success
    And no failure events are emitted

  @integration
  Scenario: Execution pool reports errors to failure handler
    Given scenario execution fails in the child process
    When the child process exits with non-zero code
    Then the failure handler emits ERROR events
    And the error message is included in the event

  # ============================================================================
  # Error Handling - Early Validation (API Level)
  # ============================================================================
  # These errors are returned immediately from the API before scheduling a job.
  # This provides instant feedback to the frontend instead of async job failures.

  @unit
  Scenario: Return immediate error when project default model not configured
    Given project has no default model configured
    When the run scenario API is called
    Then it returns an immediate error (not scheduled)
    And the error message is "Project default model is not configured"

  @unit
  Scenario: Return immediate error when prompt has no model configured
    Given prompt "Test" exists without a model configured
    And project has no default model configured
    When the run scenario API is called with prompt target
    Then it returns an immediate error (not scheduled)
    And the error message contains "does not have a model configured"

  @unit
  Scenario: Return immediate error when scenario not found
    Given scenario "nonexistent" does not exist
    When the run scenario API is called
    Then it returns an immediate error (not scheduled)
    And the error message contains "not found"

  @unit
  Scenario: Return immediate error when prompt not found
    Given scenario "Test" exists
    And prompt "nonexistent" does not exist
    When the run scenario API is called with prompt target
    Then it returns an immediate error (not scheduled)
    And the error message contains "not found"

  # ============================================================================
  # Error Handling - Worker Level (Safety Net)
  # ============================================================================
  # These errors occur in the worker if data changes after validation passed.
  # They serve as a safety net but should rarely happen in practice.

  @integration
  Scenario: Return error when scenario not found
    Given scenario "nonexistent" does not exist
    When SimulationRunnerService.execute is called
    Then it returns an error result
    And the error message contains "not found"

  @integration
  Scenario: Return error when prompt not found
    Given scenario "Test" exists
    And prompt "nonexistent" does not exist
    When SimulationRunnerService.execute is called with prompt target
    Then it returns an error result
    And the error message contains "Prompt" and "not found"

  @integration
  Scenario: Return error when HTTP agent not found
    Given scenario "Test" exists
    And HTTP agent "nonexistent" does not exist
    When SimulationRunnerService.execute is called with HTTP target
    Then it returns an error result
    And the error message contains "HTTP agent" and "not found"

  @integration
  Scenario: Return error when model provider disabled
    Given scenario "Test" exists
    And the project's model provider is disabled
    When SimulationRunnerService.execute is called
    Then it returns an error result
    And the error message contains "not configured or disabled"

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

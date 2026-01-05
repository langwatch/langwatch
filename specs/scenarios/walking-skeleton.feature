@integration @unit
Feature: On-Platform Scenarios - Walking Skeleton (S0)
  As a LangWatch user
  I want to create scenarios and run them against HTTP targets
  So that I can validate my agent's behavior on the platform

  # Routes are at /[project]/simulationsv2/* (hidden for now)

  # ============================================================================
  # Agent Model Extension (SCEN-02)
  # ============================================================================

  @unit
  Scenario: Agent types include HTTP
    Then the agentTypeSchema accepts the following types:
      | type      |
      | signature |
      | code      |
      | workflow  |
      | http      |

  @unit
  Scenario: HTTP agent config validation
    When I create an agent with type "http" and config:
      | url     | https://api.example.com/chat           |
      | method  | POST                                   |
      | headers | {"Content-Type": "application/json"}   |
    Then the config is validated against httpAgentConfigSchema
    And the agent is created successfully

  @unit
  Scenario: HTTP agent requires valid URL
    When I create an agent with type "http" and config:
      | url    | not-a-url |
      | method | POST      |
    Then validation fails with "Invalid url"

  @unit
  Scenario: HTTP agent method defaults to POST
    When I create an agent with type "http" and config:
      | url | https://api.example.com/chat |
    Then the method defaults to "POST"

  # ============================================================================
  # Scenario Schema (SCEN-01)
  # ============================================================================

  @integration
  Scenario: Create scenario
    Given I am authenticated in project "test-project"
    When I call scenario.create with:
      | name      | Refund Request Test                            |
      | situation | User requests a refund                         |
      | criteria  | ["Agent acknowledges", "Agent offers solution"] |
      | labels    | ["refund", "support"]                          |
    Then the scenario is persisted with projectId "test-project"
    And the scenario has an auto-generated ID

  @integration
  Scenario: List scenarios for project
    Given scenarios exist in project "test-project":
      | name       | labels      |
      | Scenario A | ["billing"] |
      | Scenario B | ["support"] |
    When I call scenario.list for project "test-project"
    Then I receive 2 scenarios
    And they are ordered by updatedAt desc

  @integration
  Scenario: Get scenario by ID
    Given scenario "Scenario A" exists with ID "scen_123"
    When I call scenario.get with ID "scen_123"
    Then I receive the scenario with all fields

  @integration
  Scenario: Update scenario
    Given scenario "Scenario A" exists
    When I call scenario.update with:
      | name     | Scenario A (Updated) |
      | criteria | ["New criterion"]    |
    Then the scenario name is updated
    And the criteria array is replaced
    And updatedAt is refreshed

  @integration
  Scenario: Delete scenario (soft delete)
    Given scenario "Scenario A" exists
    When I call scenario.delete with the scenario ID
    Then the scenario has archivedAt set
    And the scenario no longer appears in scenario.list

  @integration
  Scenario: Scenarios are project-scoped
    Given scenario "Scenario A" exists in project "project-1"
    And scenario "Scenario B" exists in project "project-2"
    When I call scenario.list for project "project-1"
    Then I only receive "Scenario A"

  # ============================================================================
  # Scenario Execution (SCEN-06, SCEN-07)
  # ============================================================================

  @integration
  Scenario: Run scenario against HTTP target
    Given scenario "Refund Test" exists with:
      | situation | User wants refund        |
      | criteria  | ["Acknowledges request"] |
    And agent "Test API" exists with type "http" and config:
      | url    | https://httpbin.org/post |
      | method | POST                     |
    When I call scenario.run with scenarioId and agentId
    Then the ScenarioRunnerService is invoked
    And events are emitted to ES "scenario-events"
    And a runId is returned

  @integration
  Scenario: Run returns existing run state
    Given a run is in progress for scenario "Test Scenario"
    When I call scenarios.getRunState with the runId
    Then I receive the current run state
    And the state includes conversation events

  @unit
  Scenario: HTTP target adapter invokes endpoint
    Given an HTTP agent config:
      | url    | https://api.test/chat |
      | method | POST                  |
    When the SimulationTargetAdapter processes message "Hello"
    Then an HTTP POST is made to "https://api.test/chat"
    And the response is returned

  @unit
  Scenario: HTTP target adapter handles timeout
    Given an HTTP agent config with slow endpoint
    When the SimulationTargetAdapter times out
    Then an error event is emitted with "timeout"

  @unit
  Scenario: HTTP target adapter handles non-2xx response
    Given an HTTP agent config
    When the endpoint returns 500
    Then an error event is emitted with the status code

  # ============================================================================
  # ScenarioRunnerService (SCEN-06)
  # ============================================================================

  @unit
  Scenario: ScenarioRunnerService loads scenario and agent
    Given scenario "Test" exists
    And agent "API" exists with type "http"
    When ScenarioRunnerService.run is called
    Then the scenario is loaded from ScenarioRepository
    And the agent is loaded from AgentRepository
    And the SDK scenario.run is invoked

  @unit
  Scenario: ScenarioRunnerService passes situation to SDK
    Given scenario with situation "User is angry about billing"
    When ScenarioRunnerService executes
    Then the SDK receives the situation in the config

  @unit
  Scenario: ScenarioRunnerService passes criteria to SDK
    Given scenario with criteria ["Must apologize", "Must offer refund"]
    When ScenarioRunnerService executes
    Then the SDK receives the criteria for judge evaluation


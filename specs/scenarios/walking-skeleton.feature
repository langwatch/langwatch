@integration @unit @visual
Feature: On-Platform Scenarios - Walking Skeleton (S0)
  As a LangWatch user
  I want to create scenarios and run them against HTTP targets
  So that I can validate my agent's behavior on the platform

  # Routes are at /[project]/simulationsv2/* (hidden for now, no nav link)

  # ============================================================================
  # Frontend: Navigation & List (SCEN-10)
  # ============================================================================

  @visual
  Scenario: Navigate to scenarios list
    Given I am logged into project "my-project"
    When I navigate to "/my-project/simulationsv2"
    Then I see the scenarios list page
    And I see a "New Scenario" button

  @visual
  Scenario: View scenarios list
    Given scenarios exist in the project:
      | name           | labels              |
      | Refund Flow    | ["support"]         |
      | Billing Check  | ["billing", "edge"] |
    When I am on the scenarios list page
    Then I see a list with both scenarios
    And each row shows the scenario name
    And each row shows the labels
    And each row is clickable

  @visual
  Scenario: Empty state when no scenarios
    Given no scenarios exist in the project
    When I am on the scenarios list page
    Then I see an empty state message
    And I see a call to action to create a scenario

  # ============================================================================
  # Frontend: Create Scenario (SCEN-20, SCEN-22)
  # ============================================================================

  @visual
  Scenario: Navigate to create form
    Given I am on the scenarios list page
    When I click "New Scenario"
    Then I navigate to "/[project]/simulationsv2/new"
    And I see the scenario form

  @visual
  Scenario: Scenario form fields
    When I am on the create scenario page
    Then I see the following fields:
      | field     | type          |
      | Name      | text input    |
      | Situation | textarea      |
      | Criteria  | list (add/remove) |
      | Labels    | tag input     |

  @visual
  Scenario: Add criteria to list
    Given I am on the create scenario page
    When I type a criterion "Agent must apologize"
    And I click the add button
    Then the criterion appears in the list
    And I can add more criteria

  @visual
  Scenario: Remove criteria from list
    Given criteria ["Criterion A", "Criterion B"] exist in the form
    When I click remove on "Criterion A"
    Then only "Criterion B" remains

  @visual
  Scenario: Save scenario
    Given I have filled the form with valid data
    When I click "Save"
    Then the scenario is created
    And I navigate back to the list
    And the new scenario appears in the list

  # ============================================================================
  # Frontend: Edit Scenario
  # ============================================================================

  @visual
  Scenario: Navigate to edit form
    Given scenario "Refund Flow" exists
    When I click on "Refund Flow" in the list
    Then I navigate to "/[project]/simulationsv2/[id]"
    And the form is populated with existing data

  @visual
  Scenario: Update scenario
    Given I am editing scenario "Refund Flow"
    When I change the name to "Refund Flow (Updated)"
    And I click "Save"
    Then the scenario is updated
    And I see the updated name in the list

  # ============================================================================
  # Frontend: HTTP Target Configuration (SCEN-43)
  # ============================================================================

  @visual
  Scenario: Configure HTTP target
    Given I am on the scenario edit page
    When I click "Configure Target"
    Then I see the HTTP target form with fields:
      | field   | type       |
      | URL     | text input |
      | Method  | dropdown (POST/GET) |
      | Headers | key-value pairs |

  @visual
  Scenario: Save HTTP target as Agent
    Given I have configured an HTTP target
    When I save the target
    Then an Agent with type "http" is created
    And the target is associated with the scenario run

  # ============================================================================
  # Frontend: Quick Run & Results (SCEN-24, SCEN-32)
  # ============================================================================

  @visual
  Scenario: Run scenario
    Given scenario "Refund Flow" exists with criteria
    And an HTTP target is configured
    When I click "Run"
    Then the run starts
    And I navigate to the run visualization page

  @visual
  Scenario: View run conversation
    Given a run is in progress
    When I am on the run visualization page
    Then I see the conversation between simulator and target
    And messages appear in real-time (polling)

  @visual
  Scenario: View run results
    Given a run has completed
    When I am on the run visualization page
    Then I see pass/fail for each criterion
    And I can see the full conversation history

  @visual
  Scenario: Return to list after run
    Given I am viewing run results
    When I click "Back to Scenarios"
    Then I navigate to the scenarios list
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
      | url     | https://api.example.com/chat         |
      | method  | POST                                 |
      | headers | {"Content-Type": "application/json"} |
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
      | name      | Refund Request Test                             |
      | situation | User requests a refund                          |
      | criteria  | ["Agent acknowledges", "Agent offers solution"] |
      | labels    | ["refund", "support"]                           |
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

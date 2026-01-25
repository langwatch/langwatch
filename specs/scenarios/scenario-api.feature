Feature: Scenario API
  As a backend service
  I need to provide CRUD operations for scenarios
  So that the frontend can manage scenario data

  # ============================================================================
  # Create
  # ============================================================================

  @integration
  Scenario: Create scenario with valid data
    Given I am authenticated in project "test-project"
    When I call scenario.create with:
      | name      | Refund Request Test                             |
      | situation | User requests a refund                          |
      | criteria  | ["Agent acknowledges", "Agent offers solution"] |
      | labels    | ["refund", "support"]                           |
    Then the scenario is persisted with projectId "test-project"
    And the scenario has an auto-generated ID
    And createdAt and updatedAt are set

  @integration
  Scenario: Create scenario validates required fields
    Given I am authenticated in project "test-project"
    When I call scenario.create without a name
    Then I receive a validation error
    And no scenario is created

  # ============================================================================
  # Read
  # ============================================================================

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
  Scenario: Scenarios are project-scoped
    Given scenario "Scenario A" exists in project "project-1"
    And scenario "Scenario B" exists in project "project-2"
    When I call scenario.list for project "project-1"
    Then I only receive "Scenario A"

  # ============================================================================
  # Update
  # ============================================================================

  @integration
  Scenario: Update scenario fields
    Given scenario "Scenario A" exists
    When I call scenario.update with:
      | name     | Scenario A (Updated) |
      | criteria | ["New criterion"]    |
    Then the scenario name is updated
    And the criteria array is replaced
    And updatedAt is refreshed

  @integration
  Scenario: Update preserves unmodified fields
    Given scenario with situation "Original situation" exists
    When I update only the name
    Then the situation remains unchanged

  # ============================================================================
  # Delete
  # ============================================================================

  @integration
  Scenario: Delete scenario
    Given scenario "To Delete" exists
    When I call scenario.delete with its ID
    Then the scenario is removed
    And it no longer appears in list

  # ============================================================================
  # Execution
  # ============================================================================

  @integration
  Scenario: Run scenario against prompt target
    Given scenario "Refund Test" exists with:
      | situation | User wants refund        |
      | criteria  | ["Acknowledges request"] |
    And prompt "Test Prompt" exists
    When I call scenario.run with scenarioId and promptId
    Then the SimulationRunnerService is invoked
    And events are emitted to ES "scenario-events"
    And a runId is returned

  @integration
  Scenario: Get run state returns conversation events
    Given a run is in progress for scenario "Test Scenario"
    When I call scenarios.getRunState with the runId
    Then I receive the current run state
    And the state includes conversation events

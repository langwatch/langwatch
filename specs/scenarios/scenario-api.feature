Feature: Scenario API
  As a backend service
  I need to provide CRUD operations for scenarios
  So that the frontend can manage scenario data

  # ============================================================================
  # Create
  # ============================================================================

  @integration @unimplemented
  Scenario: Create scenario validates required fields
    Given I am authenticated in project "test-project"
    When I call scenario.create without a name
    Then I receive a validation error
    And no scenario is created

  # ============================================================================
  # Read
  # ============================================================================

  # ============================================================================
  # Update
  # ============================================================================

  @integration @unimplemented
  Scenario: Update preserves unmodified fields
    Given scenario with situation "Original situation" exists
    When I update only the name
    Then the situation remains unchanged

  # ============================================================================
  # Delete
  # ============================================================================

  # ============================================================================
  # Execution
  # ============================================================================

  @integration @unimplemented
  Scenario: Run scenario against prompt target
    Given scenario "Refund Test" exists with:
      | situation | User wants refund        |
      | criteria  | ["Acknowledges request"] |
    And prompt "Test Prompt" exists
    When I call scenario.run with scenarioId and promptId
    Then the SimulationRunnerService is invoked
    And events are emitted to ES "scenario-events"
    And a runId is returned

  @integration @unimplemented
  Scenario: Get run state returns conversation events
    Given a run is in progress for scenario "Test Scenario"
    When I call scenarios.getRunState with the runId
    Then I receive the current run state
    And the state includes conversation events

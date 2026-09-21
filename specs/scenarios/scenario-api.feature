Feature: Scenario API
  As a backend service
  I need to provide CRUD operations for scenarios
  So that the frontend can manage scenario data

  # Per AUDIT_MANIFEST.md: 10 scenarios → 6 DUPLICATE (already covered elsewhere
  # and removed) + 2 UPDATE + 2 KEEP. The 4 remaining @unimplemented scenarios
  # need rewrites or new integration tests in PR #3458 — Zod-validation rewrite,
  # event-sourcing rewrite for run scenario, partial-update merge semantics, and
  # getRunState shape assertion.

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
  # Model overrides and turn limits over REST
  # ============================================================================

  # The UI already edits simulatorModel, judgeModel, maxTurns and minTurns
  # through tRPC. The public REST API must expose the same fields, or a
  # scenario managed as code silently loses them.

  @integration
  Scenario: Create over REST accepts model overrides and turn limits
    Given I am authenticated with a project API key
    When I POST a scenario with simulatorModel "openai/gpt-5-mini", judgeModel "openai/gpt-5-mini", maxTurns 8 and minTurns 2
    Then the response carries those values back
    And GET on the scenario returns the same values

  @integration
  Scenario: Update over REST clears a model override with null
    Given a scenario with a simulator model override
    When I PUT the scenario with simulatorModel null
    Then the stored override is cleared
    And GET on the scenario returns simulatorModel null

  @integration
  Scenario: PATCH updates a scenario the same way PUT does
    Given a scenario exists
    When I PATCH the scenario with a new name
    Then the response is 200 and carries the new name

  @integration
  Scenario: REST rejects a model override with no provider prefix
    Given I am authenticated with a project API key
    When I POST a scenario with simulatorModel "latest"
    Then the response is a validation error

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

Feature: Scenario Execution
  As a LangWatch user
  I want to run scenarios against my agents
  So that I can validate their behavior meets my criteria

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Running Scenarios
  # ============================================================================

  @e2e
  Scenario: Run scenario with prompt target
    Given scenario "Refund Flow" exists with criteria
    And prompt "Support Agent" is configured as target
    When I click "Run"
    Then the run starts
    And I navigate to the run visualization page

  @e2e
  Scenario: Run scenario with HTTP agent target
    Given scenario "Refund Flow" exists with criteria
    And HTTP agent "Production API" is configured as target
    When I click "Run"
    Then the run starts
    And I see the conversation begin

  # ============================================================================
  # Viewing Results
  # ============================================================================

  @e2e
  Scenario: View conversation in real-time
    Given a run is in progress
    When I am on the run visualization page
    Then I see the conversation between simulator and target
    And new messages appear as they are generated

  @e2e
  Scenario: View completed run results
    Given a run has completed
    When I am on the run visualization page
    Then I see pass/fail status for each criterion
    And I see the full conversation history
    And I can see the reasoning for each judgment

  @e2e
  Scenario: Navigate back to scenarios after viewing results
    Given I am viewing run results
    When I click "Back to Scenarios"
    Then I navigate to the scenarios list

  # ============================================================================
  # Run History
  # ============================================================================

  @e2e
  Scenario: View run history for a scenario
    Given scenario "Refund Flow" has been run multiple times
    When I view the run history
    Then I see a list of past runs with timestamps
    And I can click any run to view its details

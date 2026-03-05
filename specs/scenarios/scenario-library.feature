Feature: Scenario Library
  As a LangWatch user
  I want to browse and manage my scenarios
  So that I can organize my behavioral test cases

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Navigation
  # ============================================================================

  @integration
  Scenario: Navigate to scenarios list
    When I navigate to "/my-project/simulations"
    Then I see the scenarios list page
    And I see a "New Scenario" button

  # ============================================================================
  # List View
  # ============================================================================

  @e2e
  Scenario: View scenarios in list
    Given scenarios exist in the project:
      | name          | labels              |
      | Refund Flow   | ["support"]         |
      | Billing Check | ["billing", "edge"] |
    When I am on the scenarios list page
    Then I see a list with both scenarios
    And each row shows the scenario name
    And each row shows the labels

  @e2e
  Scenario: Click scenario row to edit
    Given scenario "Refund Flow" exists
    When I click on "Refund Flow" in the list
    Then I navigate to the scenario editor

  @integration
  Scenario: Empty state when no scenarios
    Given no scenarios exist in the project
    When I am on the scenarios list page
    Then I see an empty state message
    And I see a call to action to create a scenario

  # ============================================================================
  # Filtering
  # ============================================================================

  @e2e
  Scenario: Filter scenarios by label
    Given scenarios exist with various labels
    When I select label "support" in the filter
    Then I only see scenarios with the "support" label

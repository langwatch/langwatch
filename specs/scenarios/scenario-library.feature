Feature: Scenario Library
  As a LangWatch user
  I want to browse and manage my scenarios
  So that I can organize my behavioral test cases

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Navigation
  # ============================================================================

  @integration @unimplemented
  Scenario: Navigate to scenarios list
    When I navigate to "/my-project/simulations"
    Then I see the scenarios list page
    And I see a "New Scenario" button

  # ============================================================================
  # List View
  # ============================================================================

  @e2e @unimplemented
  Scenario: Click scenario row to edit
    Given scenario "Refund Flow" exists
    When I click on "Refund Flow" in the list
    Then I navigate to the scenario editor

  @integration @unimplemented
  Scenario: Empty state when no scenarios
    Given no scenarios exist in the project
    When I am on the scenarios list page
    Then I see an empty state message
    And I see a call to action to create a scenario

  # ============================================================================
  # Filtering
  # ============================================================================


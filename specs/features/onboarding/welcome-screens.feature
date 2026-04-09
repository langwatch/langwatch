Feature: Welcome Onboarding Screen for Scenarios
  As a new LangWatch user
  I want to see an introduction when I create my first scenario
  So that I understand what scenarios do before getting started

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Welcome Screen Trigger
  # ============================================================================

  @integration
  Scenario: Show welcome screen on first scenario creation
    Given no scenarios exist in the project
    When I click "New Scenario"
    Then I see the scenario welcome screen

  @integration
  Scenario: Proceed from welcome screen to scenario creation
    Given no scenarios exist in the project
    And I see the scenario welcome screen
    When I click the proceed button
    Then the scenario creation flow opens

  @integration
  Scenario: Skip welcome screen when scenarios already exist
    Given scenarios exist in the project
    When I click "New Scenario"
    Then the scenario creation flow opens directly
    And I do not see the scenario welcome screen

  # ============================================================================
  # Welcome Screen Content
  # ============================================================================

  @integration
  Scenario: Scenario welcome screen content
    When I render the scenario welcome screen
    Then I see a title mentioning scenarios
    And I see a description explaining scenarios test agent behavior
    And I see capability highlights including automated testing and regression detection
    And I see a primary call-to-action button

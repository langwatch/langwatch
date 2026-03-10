Feature: Nested drawer typing
  As a user editing a suite
  I want to type in input fields inside nested drawers
  So that I can create scenarios or agents without leaving the suite editor

  Background:
    Given I am on the suites page with a project

  # Full user workflow: open suite editor, open child drawer, type in it
  @e2e
  Scenario: User types in a nested drawer opened from the suite editor
    Given the suite editor drawer is open
    When I open the scenario editor from the suite editor
    And I type "My new scenario" into the name field
    Then the name field contains "My new scenario"

  # Verify focus is correctly transferred when navigating between drawers
  @integration
  Scenario: Focus moves to the nested drawer when it opens
    Given the suite editor drawer is open
    When I open the scenario editor from the suite editor
    Then the scenario editor drawer has focus
    And keyboard input is captured by the scenario editor

  # Verify typing still works after returning from a nested drawer
  @integration
  Scenario: Typing works in the parent drawer after closing a nested drawer
    Given the suite editor drawer is open
    And the scenario editor was opened and then closed via back navigation
    When I type "Updated suite name" into the suite name field
    Then the suite name field contains "Updated suite name"

  # Verify the command bar does not steal keystrokes from drawer inputs
  @integration
  Scenario: Command bar does not intercept typing in a nested drawer
    Given the scenario editor drawer is open from the suite editor
    When I focus an input field in the scenario editor
    And I press the "k" key
    Then the input field receives the "k" character
    And the command bar does not open

Feature: All Runs is selected by default on Suites page
  As a user navigating to the Suites page
  I want the "All Runs" view to be selected by default
  So that I immediately see run history without an extra click

  @integration
  Scenario: All Runs is selected when page loads
    Given the Suites page has loaded
    Then "All Runs" is the selected sidebar item
    And the All Runs panel is displayed in the main area

  @integration
  Scenario: All Runs is selected after deleting the current suite
    Given the Suites page has loaded
    And a suite is selected
    When the user deletes the selected suite
    Then "All Runs" is the selected sidebar item
    And the All Runs panel is displayed in the main area

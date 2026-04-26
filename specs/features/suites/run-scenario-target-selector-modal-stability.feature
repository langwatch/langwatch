Feature: Run Scenario target selector does not close the modal
  As a LangWatch user viewing a suite run
  I want to select a target from the dropdown inside the Run Scenario modal
  So that I can choose a prompt or agent and then click Run without the modal closing

  Background:
    Given the Run Scenario modal is open
    And there is at least one prompt and one agent available

  @integration @unimplemented
  Scenario: Clicking outside the modal still closes the modal
    When I click outside the Run Scenario modal
    Then the Run Scenario modal closes

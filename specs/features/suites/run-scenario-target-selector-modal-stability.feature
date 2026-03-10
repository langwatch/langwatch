Feature: Run Scenario target selector does not close the modal
  As a LangWatch user viewing a suite run
  I want to select a target from the dropdown inside the Run Scenario modal
  So that I can choose a prompt or agent and then click Run without the modal closing

  Background:
    Given the Run Scenario modal is open
    And there is at least one prompt and one agent available

  @integration
  Scenario: Selecting a prompt keeps the modal open
    When I open the target selector dropdown
    And I click a prompt in the dropdown
    Then the dropdown closes
    And the selected prompt is shown in the target selector trigger
    And the Run Scenario modal remains open

  @integration
  Scenario: Selecting an agent keeps the modal open
    When I open the target selector dropdown
    And I click an agent in the dropdown
    Then the dropdown closes
    And the selected agent is shown in the target selector trigger
    And the Run Scenario modal remains open

  @integration
  Scenario: Clicking outside the dropdown closes only the dropdown
    When I open the target selector dropdown
    And I click inside the modal body but outside the dropdown
    Then the dropdown closes
    And the Run Scenario modal remains open

  @integration
  Scenario: Clicking outside the modal still closes the modal
    When I click outside the Run Scenario modal
    Then the Run Scenario modal closes

  @integration
  Scenario: Completing the full run flow after selecting a target
    When I open the target selector dropdown
    And I click a prompt in the dropdown
    And I click the Run button
    Then the scenario run is initiated with the selected target

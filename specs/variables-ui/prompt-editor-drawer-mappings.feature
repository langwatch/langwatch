Feature: Prompt Editor Drawer Variable Mappings in Evaluations V3

  As a user editing a prompt in the Evaluations V3 context
  I want to map prompt variables to dataset columns
  So that I can connect my prompt inputs to the evaluation data

  Background:
    Given I am in the Evaluations V3 context
    And I have a dataset with columns "question" and "expected_answer"
    And I have a prompt runner with an input variable "input"
    And I open the prompt editor drawer

  Scenario: Variable mapping shows available sources
    When I click on the variable mapping dropdown for "input"
    Then I should see a dropdown with available sources
    And the sources should include dataset columns "question" and "expected_answer"

  Scenario: Select a dataset column mapping
    When I click on the variable mapping dropdown for "input"
    And I select "question" from the "Test Data" dataset
    Then the variable "input" should be mapped to "Test Data.question"
    And the mapping should be visually indicated with source icon

  Scenario: Search/filter available sources
    Given I have multiple dataset columns
    When I click on the variable mapping dropdown for "input"
    And I type "quest" in the search input
    Then only columns containing "quest" should be shown

  Scenario: Clear mapping
    Given variable "input" is mapped to "Test Data.question"
    When I clear the mapping for "input"
    Then the variable "input" should have no mapping

  Scenario: Mapping persists to local config
    When I map variable "input" to "Test Data.question"
    Then the mapping should be stored in the runner's local config
    And the mapping should persist when I close and reopen the drawer

  Scenario: Show no sources when not in evaluations context
    Given I am in the Prompt Playground context
    And there are no available sources
    When I view the variables section
    Then I should see simple value inputs instead of mapping dropdowns

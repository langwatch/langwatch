Feature: Per-Dataset Variable Mappings
  As a user creating evaluations
  I want variable mappings to be stored per dataset
  So that I can have different mappings for different datasets in the same evaluation

  Background:
    Given I have an evaluation workbench open
    And I have two datasets:
      | name           | columns                |
      | Test Data      | input, expected_output |
      | Another Dataset| foo, bar, input, expected_output |
    And I have a prompt runner with input field "question"

  # ============================================================================
  # Dataset-Scoped Sources
  # ============================================================================

  Scenario: Available sources show only active dataset columns
    Given "Test Data" is the active dataset
    When I open the prompt editor drawer
    And I click on the variable mapping input for "question"
    Then I see only columns from "Test Data":
      | column          |
      | input           |
      | expected_output |
    And I do not see columns from "Another Dataset"

  Scenario: Sources update when switching active dataset
    Given "Test Data" is the active dataset
    And I have the prompt editor drawer open
    When I switch to "Another Dataset" using the dataset tabs
    Then the variable mapping dropdown shows columns from "Another Dataset":
      | column          |
      | foo             |
      | bar             |
      | input           |
      | expected_output |
    And the dropdown does not show columns from "Test Data"

  Scenario: Variable insert menu shows only active dataset sources
    Given "Test Data" is the active dataset
    When I open the prompt editor drawer
    And I type "{{" in the prompt textarea
    Then the variable insert menu shows "Test Data" as a source
    And the variable insert menu does not show "Another Dataset"

  # ============================================================================
  # Per-Dataset Mapping Storage
  # ============================================================================

  Scenario: Mappings are stored per dataset
    Given "Test Data" is the active dataset
    And I open the prompt editor drawer
    When I map "question" to "input" from "Test Data"
    And I close the drawer
    And I switch to "Another Dataset"
    Then the mapping for "question" is empty for "Another Dataset"

  Scenario: Mappings persist when switching datasets
    Given I map "question" to "input" for "Test Data"
    And I map "question" to "foo" for "Another Dataset"
    When I switch between datasets
    Then "Test Data" shows "question" mapped to "input"
    And "Another Dataset" shows "question" mapped to "foo"

  Scenario: Creating a variable from dataset source sets mapping for that dataset only
    Given "Test Data" is the active dataset
    And I open the prompt editor drawer
    When I type "{{input" in the prompt textarea
    And I select "input" from "Test Data" in the variable menu
    Then a variable "input" is created
    And "input" is mapped to "input" column from "Test Data"
    And "input" has no mapping for "Another Dataset"

  # ============================================================================
  # Drawer Updates on Dataset Switch
  # ============================================================================

  Scenario: Drawer shows correct mappings for active dataset
    Given I have mappings:
      | dataset         | field    | mapped_to |
      | Test Data       | question | input     |
      | Another Dataset | question | foo       |
    And "Test Data" is the active dataset
    When I open the prompt editor drawer
    Then the "question" field shows mapping to "input"

  Scenario: Drawer updates when dataset changes while open
    Given I have mappings:
      | dataset         | field    | mapped_to |
      | Test Data       | question | input     |
      | Another Dataset | question | foo       |
    And I have the prompt editor drawer open for "Test Data"
    When I switch to "Another Dataset"
    Then the "question" field shows mapping to "foo"

  # ============================================================================
  # DSL Conversion
  # ============================================================================

  Scenario: DSL adapter uses active dataset mappings when building workflow
    Given I have mappings:
      | dataset         | field    | mapped_to |
      | Test Data       | question | input     |
      | Another Dataset | question | foo       |
    And "Another Dataset" is the active dataset
    When the workflow DSL is generated
    Then the DSL edges connect "question" input to "foo" from the dataset node

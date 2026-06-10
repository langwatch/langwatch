@unit
Feature: Dataset inline editing
  As a user configuring an evaluation
  I want to edit dataset values directly in the spreadsheet
  So that I can quickly create and modify test data

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the dataset has columns "input" and "expected_output"

  @unimplemented
  Scenario: Navigate to next cell with Tab while editing
    Given the dataset has 3 rows
    When I double-click the cell at row 0, column "input"
    And I type "value1"
    And I press Tab
    Then the cell at row 0, column "expected_output" is selected

  @unimplemented
  Scenario: Select row with checkbox
    Given the dataset has 3 rows
    When I click the checkbox for row 0
    Then row 0 is selected
    And all cells in row 0 have a blue selection background

  @unimplemented
  Scenario: Select multiple rows with checkboxes
    Given the dataset has 3 rows
    When I click the checkbox for row 0
    And I click the checkbox for row 2
    Then rows 0 and 2 are selected
    And a selection toolbar appears at the bottom

  @unimplemented
  Scenario: Select all rows with header checkbox
    Given the dataset has 3 rows
    When I click the checkbox in the header
    Then all 3 rows are selected

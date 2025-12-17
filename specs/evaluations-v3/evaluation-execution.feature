@unit
Feature: Evaluation execution
  As a user running an evaluation
  I want to execute agents and evaluators on my dataset
  So that I can see results inline in the spreadsheet

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the dataset has 3 rows with test data
    And an agent "GPT-4o" is configured and mapped
    And an evaluator "Exact Match" is configured and mapped

  Scenario: Run evaluation button is enabled when ready
    Then the "Evaluate" button is enabled

  Scenario: Run evaluation button is disabled when not ready
    Given an agent has unmapped required inputs
    Then the "Evaluate" button is disabled
    And a tooltip explains what needs to be configured

  Scenario: Execute evaluation shows loading skeletons
    When I click the "Evaluate" button
    Then the "Evaluate" button changes to a "Stop" button
    And all agent output cells show loading skeleton bars
    And all evaluator cells show loading skeleton bars

  Scenario: Results stream in as they complete
    Given an evaluation is running
    When the first row completes processing
    Then the skeleton in row 0 agent cell is replaced with the actual output
    And the skeleton in row 0 evaluator cell is replaced with the result
    And the other rows still show loading skeletons

  Scenario: Show success status in evaluator cell
    When I run the evaluation
    And row 0 passes the evaluation
    Then the evaluator cell for row 0 shows a success indicator

  Scenario: Show failure status in evaluator cell
    When I run the evaluation
    And row 0 fails the evaluation
    Then the evaluator cell for row 0 shows a failure indicator

  Scenario: Show error in cell when execution fails
    When I run the evaluation
    And row 0 encounters an error
    Then the agent output cell for row 0 shows an error state
    And I can click to see the error details

  Scenario: Stop running evaluation
    When I click the "Evaluate" button
    And the evaluation is in progress
    And I click the "Stop" button
    Then the evaluation stops
    And completed results are preserved

  Scenario: Edit dataset while viewing results
    When I run the evaluation
    And results are displayed
    And I double-click a dataset cell
    Then I can edit the cell value
    And the corresponding result cells show as stale or clear

  Scenario: Run evaluation on selected rows only
    Given rows 0 and 2 are selected via checkboxes
    When I click the "Run" button in the selection toolbar
    Then only rows 0 and 2 show loading skeletons
    And row 1 remains unchanged

@unit
Feature: Evaluation execution - UI
  As a user running an evaluation
  I want to execute targets and evaluators on my dataset
  So that I can see results inline in the spreadsheet

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the dataset has 3 rows with input/expected_output test data
    And a target "my-prompt" is configured and mapped
    And target "my-prompt" has evaluator "exact_match" configured and mapped

  # ==========================================================================
  # Full Execution UI
  # ==========================================================================

  Scenario: Run evaluation button is enabled when ready
    Then the "Evaluate" button is enabled

  Scenario: Run evaluation button is disabled when not ready
    Given a target has unmapped required inputs
    Then the "Evaluate" button is disabled
    And a tooltip explains what needs to be configured

  Scenario: Execute evaluation shows loading skeletons
    When I click the "Evaluate" button
    Then the "Evaluate" button changes to a "Stop" button
    And all target output cells show loading skeleton bars
    And the evaluator chips inside target cells show loading state

  Scenario: Results stream in as they complete
    Given an evaluation is running
    When the first row completes processing
    Then the skeleton in row 0 target cell is replaced with the actual output
    And the evaluator chips in row 0 update with their results
    And the other rows still show loading skeletons

  Scenario: Progress indicator updates during execution
    When I click the "Evaluate" button
    Then a progress indicator shows "0/3" completed
    When row 0 completes
    Then the progress indicator shows "1/3" completed
    When all rows complete
    Then the progress indicator shows "3/3" completed

  # ==========================================================================
  # Result Display
  # ==========================================================================

  Scenario: Evaluator chips show pass status
    When I run the evaluation
    And row 0 passes the "exact_match" evaluator
    Then the "exact_match" chip in row 0 shows a success indicator (green checkmark)

  Scenario: Evaluator chips show fail status
    When I run the evaluation
    And row 0 fails the "exact_match" evaluator
    Then the "exact_match" chip in row 0 shows a failure indicator (red X)

  Scenario: Expand evaluator chip to see details
    When I run the evaluation
    And results are displayed
    And I click on the "exact_match" evaluator chip in row 0
    Then the chip expands to show full result details
    And I see the passed status and any details

  # ==========================================================================
  # Aggregate Statistics at Target Headers
  # ==========================================================================

  Scenario: Target header shows aggregate pass rate
    When I run the evaluation
    And 2 out of 3 rows pass "exact_match"
    Then the target header for "my-prompt" shows "67% pass rate"

  Scenario: Aggregate stats update in real-time
    When I click the "Evaluate" button
    Then the aggregate stats show "0/0" initially
    When row 0 completes with pass
    Then the aggregate stats update to "1/1 (100%)"
    When row 1 completes with fail
    Then the aggregate stats update to "1/2 (50%)"

  # ==========================================================================
  # Error Handling - Target Errors (UI)
  # ==========================================================================

  Scenario: Show error in target cell when target execution fails
    When I run the evaluation
    And the target for row 0 fails with error "Rate limit exceeded"
    Then the target output cell for row 0 shows an error state with red background
    And I can see a truncated error message "Rate limit exceeded"

  Scenario: Expand target error to see full details
    Given row 0 target has an error "Rate limit exceeded: Please wait 60 seconds"
    When I click on the error indicator in row 0
    Then an expandable panel shows the full error message

  # ==========================================================================
  # Error Handling - Evaluator Errors (UI)
  # ==========================================================================

  Scenario: Show error in evaluator chip when evaluator fails
    When I run the evaluation
    And the "exact_match" evaluator for row 0 fails with error "Missing expected_output"
    Then the "exact_match" chip in row 0 shows an error indicator
    And the target output is still displayed (only evaluator failed)

  # ==========================================================================
  # Error Handling - Fatal Errors (UI)
  # ==========================================================================

  Scenario: Show toast for fatal execution errors
    When I click the "Evaluate" button
    And the backend returns a network error
    Then a toast notification appears with "Execution failed: Network error"
    And the evaluation stops
    And cells that were loading show an error state

  # ==========================================================================
  # Partial Execution UI
  # ==========================================================================

  Scenario: Run button on target header executes only that target
    Given targets "my-prompt" and "other-prompt" are configured
    When I click the run button on "my-prompt" target header
    Then only "my-prompt" cells show loading skeletons
    And "other-prompt" cells remain unchanged

  Scenario: Run button on row executes only that row
    When I hover over row 0
    Then a small play button appears on the row
    When I click the row play button
    Then only row 0 shows loading skeletons across all targets
    And rows 1 and 2 remain unchanged

  Scenario: Run button on cell executes only that cell
    Given targets "my-prompt" and "other-prompt" are configured
    When I hover over the "my-prompt" cell in row 0
    Then a small play button appears
    When I click the cell play button
    Then only that specific cell shows loading skeleton

  # ==========================================================================
  # Abort UI
  # ==========================================================================

  Scenario: Stop running evaluation
    When I click the "Evaluate" button
    And the evaluation is in progress with 1/3 completed
    And I click the "Stop" button
    Then the evaluation stops processing new cells
    And completed results (row 0) are preserved
    And pending cells return to idle state
    And the button changes back to "Evaluate"

  # ==========================================================================
  # Multiple Targets UI
  # ==========================================================================

  Scenario: Same evaluator on multiple targets shows separate results
    Given targets "my-prompt" and "other-prompt" are configured
    And both targets have evaluator "exact_match" configured
    When I run the evaluation
    Then each target cell shows its own "exact_match" result
    And I can compare pass rates between targets in their headers

  # ==========================================================================
  # Dataset Interaction
  # ==========================================================================

  Scenario: Edit dataset while viewing results
    When I run the evaluation
    And results are displayed
    And I double-click a dataset cell
    Then I can edit the cell value
    And the corresponding target cells show as stale (dimmed)

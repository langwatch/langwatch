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

  @unimplemented
  Scenario: Run evaluation button is enabled when ready
    Then the "Evaluate" button is enabled

  @unimplemented
  Scenario: Run evaluation button is disabled when not ready
    Given a target has unmapped required inputs
    Then the "Evaluate" button is disabled
    And a tooltip explains what needs to be configured

  @unimplemented
  Scenario: Execute evaluation shows loading skeletons
    When I click the "Evaluate" button
    Then the "Evaluate" button changes to a "Stop" button
    And all target output cells show loading skeleton bars
    And the evaluator chips inside target cells show loading state

  @unimplemented
  Scenario: Results stream in as they complete
    Given an evaluation is running
    When the first row completes processing
    Then the skeleton in row 0 target cell is replaced with the actual output
    And the evaluator chips in row 0 update with their results
    And the other rows still show loading skeletons

  @unimplemented
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

  @unimplemented
  Scenario: Evaluator chips show pass status
    When I run the evaluation
    And row 0 passes the "exact_match" evaluator
    Then the "exact_match" chip in row 0 shows a success indicator (green checkmark)

  @unimplemented
  Scenario: Evaluator chips show fail status
    When I run the evaluation
    And row 0 fails the "exact_match" evaluator
    Then the "exact_match" chip in row 0 shows a failure indicator (red X)

  @unimplemented
  Scenario: Expand evaluator chip to see details
    When I run the evaluation
    And results are displayed
    And I click on the "exact_match" evaluator chip in row 0
    Then the chip expands to show full result details
    And I see the passed status and any details

  # ==========================================================================
  # Aggregate Statistics at Target Headers
  # ==========================================================================

  @unimplemented
  Scenario: Target header shows aggregate pass rate
    When I run the evaluation
    And 2 out of 3 rows pass "exact_match"
    Then the target header for "my-prompt" shows "67% pass rate"

  @unimplemented
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

  @unimplemented
  Scenario: Show error in target cell when target execution fails
    When I run the evaluation
    And the target for row 0 fails with error "Rate limit exceeded"
    Then the target output cell for row 0 shows an error state with red background
    And I can see a truncated error message "Rate limit exceeded"

  @unimplemented
  Scenario: Expand target error to see full details
    Given row 0 target has an error "Rate limit exceeded: Please wait 60 seconds"
    When I click on the error indicator in row 0
    Then an expandable panel shows the full error message

  # ==========================================================================
  # Error Handling - Evaluator Errors (UI)
  # ==========================================================================

  @unimplemented
  Scenario: Show error in evaluator chip when evaluator fails
    When I run the evaluation
    And the "exact_match" evaluator for row 0 fails with error "Missing expected_output"
    Then the "exact_match" chip in row 0 shows an error indicator
    And the target output is still displayed (only evaluator failed)

  # ==========================================================================
  # Error Handling - Fatal Errors (UI)
  # ==========================================================================

  @unimplemented
  Scenario: Show toast for fatal execution errors
    When I click the "Evaluate" button
    And the backend returns a network error
    Then a toast notification appears with "Execution failed: Network error"
    And the evaluation stops
    And cells that were loading show an error state

  # ==========================================================================
  # Error Handling - Nothing To Evaluate
  # ==========================================================================

  @integration
  Scenario: An evaluator with no resolved inputs reports an error instead of a pass
    Given the "exact_match" evaluator has none of its fields mapped
    When I run the evaluation
    Then the evaluator is not sent to the evaluation service
    And the "exact_match" chip in every row shows an error
    And the error names the evaluator and says to map its fields
    And the run reports no passes for that evaluator

  @integration
  Scenario: An evaluator column with no resolved inputs reports an error instead of passing
    Given an evaluator is run as its own column and none of its fields are mapped
    When I run the evaluation
    Then the column is not sent to the evaluation service
    And every row of the column shows an error
    And the error names the evaluator and says to map its fields

  @unit
  Scenario: An evaluator that compares two fields lists both as required
    Given the workbench reads the fields of "exact_match" from the evaluator catalog
    When it classifies each field as required or optional
    Then "output" and "expected_output" are both required
    And the same holds for "llm_answer_match", whose judge needs both answers

  Scenario: A comparison the user has not finished configuring says what to fix
    Given a comparison column with fewer than 2 columns picked to compare
    When I run the evaluation
    Then every row of the comparison column shows an error
    And the error says to pick the columns to compare
    And a comparison whose golden answer is on with no column picked says to pick the golden field

  # ==========================================================================
  # Comparisons And Partial Runs
  # ==========================================================================

  @integration
  Scenario: Running one candidate keeps the comparison's other columns
    Given a comparison judges the "baseline" and "candidate" columns against each other
    And "baseline" already has an output for every row
    When I run only the "candidate" column
    Then the comparison judges every row
    And no row says it is waiting on "baseline"
    And "baseline" is not run again, because its saved output is reused
    And a "baseline" with no saved output is run as part of the same run
    And a run started with no page open reads those saved outputs the same way

  # ==========================================================================
  # Following A Run
  # ==========================================================================

  @integration
  Scenario: A run started from the open page is readable by the run API
    Given the workbench page starts a run
    When I ask the run API for that run
    Then it reports the run's progress, and its summary once it ends
    And a stopped run reads as stopped
    And a failed run reports the failure's code, never the thrown message
    And a run id nothing knows about is still not found

  # ==========================================================================
  # Multiple Datasets And Pinned Versions
  # ==========================================================================

  @integration
  Scenario: The run reads its mappings from the dataset the rows come from
    Given the workbench has 2 datasets and the second one is active
    And the mappings are set on the active dataset
    When I run the evaluation
    Then the target and evaluator run with the values from the active dataset
    And no cell runs with an empty input

  @integration
  Scenario: Two columns pinned to different versions of one prompt each run their own version
    Given target "my-prompt v1" is pinned to version 1 of a prompt
    And target "my-prompt v2" is pinned to version 2 of the same prompt
    When I run the evaluation
    Then each column runs the version it is pinned to
    And the run records the version and model of each column separately

  # ==========================================================================
  # Partial Execution UI
  # ==========================================================================
  @unimplemented
  Scenario: Run button on cell executes only that cell
    Given targets "my-prompt" and "other-prompt" are configured
    When I hover over the "my-prompt" cell in row 0
    Then a small play button appears
    When I click the cell play button
    Then only that specific cell shows loading skeleton

  # ==========================================================================
  # Abort UI
  # ==========================================================================

  @unimplemented
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

  @unimplemented
  Scenario: Same evaluator on multiple targets shows separate results
    Given targets "my-prompt" and "other-prompt" are configured
    And both targets have evaluator "exact_match" configured
    When I run the evaluation
    Then each target cell shows its own "exact_match" result
    And I can compare pass rates between targets in their headers

  # ==========================================================================
  # Dataset Interaction
  # ==========================================================================

  @unimplemented
  Scenario: Edit dataset while viewing results
    When I run the evaluation
    And results are displayed
    And I double-click a dataset cell
    Then I can edit the cell value
    And the corresponding target cells show as stale (dimmed)

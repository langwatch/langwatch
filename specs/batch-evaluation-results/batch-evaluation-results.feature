@unit
Feature: Batch Evaluation Results Visualization
  As a user reviewing evaluation results
  I want to see a clear visualization of my evaluation runs
  So that I can understand how my targets performed across the dataset

  Background:
    Given I am on the experiment results page
    And an evaluation run has completed

  # ============================================================================
  # Data Display - Dataset Columns
  # ============================================================================

  Scenario: Display dataset columns in the table
    Given the evaluation was run on a dataset with columns "input", "expected_output"
    When the results table renders
    Then I see columns for each dataset field
    And the "input" column shows the original dataset values
    And the "expected_output" column shows the expected values

  Scenario: Display images in dataset columns
    Given the dataset has a column with image URLs
    When the results table renders
    Then images are rendered inline in the dataset cells
    And images have appropriate max dimensions for the table

  Scenario: Truncate long text in dataset cells
    Given a dataset cell contains text longer than 10000 characters
    When the results table renders
    Then the text is truncated with a "(truncated)" indicator
    And I can click to expand and see more of the content

  # ============================================================================
  # Data Display - Target Columns
  # ============================================================================

  Scenario: Display target output columns
    Given the evaluation has 2 targets "GPT-4o" and "Claude"
    When the results table renders
    Then I see a column for each target
    And the column header shows the target name
    And each row shows the output from that target

  Scenario: Display target output with cost and duration
    Given a target produced output with cost $0.001 and latency 1.2s
    When I hover over the target cell
    Then I see the latency displayed
    And I can access cost information

  Scenario: Display error state in target cell
    Given a target execution failed with error "Rate limit exceeded"
    When the results table renders
    Then the target cell shows an error indicator
    And the error message "Rate limit exceeded" is visible

  Scenario: Expand long target output
    Given a target output is longer than the cell max height (120px)
    When the results table renders
    Then a fade overlay appears at the bottom of the cell
    When I click on the cell
    Then the output expands to show the full content
    And I can dismiss the expanded view by clicking outside

  # ============================================================================
  # Evaluator Results Display
  # ============================================================================

  Scenario: Display evaluator chips below target output
    Given a target has 2 evaluators "Exact Match" and "LLM as Judge"
    And both evaluators have completed
    When the results table renders
    Then I see evaluator chips below the target output
    And each chip shows the evaluator name and result

  Scenario: Evaluator chip shows pass status
    Given an evaluator "Exact Match" passed with score 1.0
    When the results table renders
    Then the evaluator chip shows a green indicator
    And the chip displays "passed"

  Scenario: Evaluator chip shows fail status
    Given an evaluator "Exact Match" failed with score 0.0
    When the results table renders
    Then the evaluator chip shows a red indicator
    And the chip displays "failed"

  Scenario: Evaluator chip shows error status
    Given an evaluator execution failed with an error
    When the results table renders
    Then the evaluator chip shows an error indicator
    And hovering shows the error details

  Scenario: Evaluator chip hover shows details
    Given an evaluator "LLM as Judge" completed with score 0.75 and details
    When I hover over the evaluator chip
    Then I see the full score
    And I see the evaluation details/reasoning

  # ============================================================================
  # Trace Links
  # ============================================================================

  Scenario: View trace for a target execution
    Given a target execution has an associated trace_id
    When I hover over the target cell
    Then I see a "View Trace" button
    When I click the "View Trace" button
    Then a trace drawer opens showing execution details

  Scenario: No trace link when no trace_id
    Given a target execution has no trace_id
    When the results table renders
    Then no "View Trace" button is shown for that cell

  # ============================================================================
  # Run Selection Sidebar
  # ============================================================================

  Scenario: Display list of evaluation runs
    Given there are 3 completed evaluation runs
    When I view the experiment page
    Then I see a sidebar with all 3 runs listed
    And runs are ordered by timestamp (most recent first)
    And the most recent run is selected by default

  Scenario: Run shows summary information
    Given an evaluation run completed with 2 evaluators
    When I view the runs sidebar
    Then each run shows the timestamp
    And each run shows a summary of evaluator scores
    And each run shows the total cost

  Scenario: Select a different run
    Given I am viewing run 1
    And run 2 exists in the sidebar
    When I click on run 2 in the sidebar
    Then the results table updates to show run 2 results
    And run 2 is highlighted as selected

  Scenario: Show running indicator for in-progress run
    Given an evaluation is currently running
    When I view the runs sidebar
    Then the running evaluation shows a spinner
    And results update in real-time as they arrive

  Scenario: Show stopped indicator for stopped run
    Given an evaluation was manually stopped
    When I view the runs sidebar
    Then the stopped run shows a red indicator
    And partial results are still viewable

  # ============================================================================
  # CSV Export
  # ============================================================================

  Scenario: Export results to CSV
    Given I am viewing an evaluation run with results
    When I click the "Export to CSV" button
    Then a CSV file is downloaded
    And the filename includes the experiment name and date

  Scenario: CSV contains all columns
    Given the evaluation has dataset columns, target outputs, and evaluator results
    When I export to CSV
    Then the CSV contains dataset columns
    And the CSV contains target output columns
    And the CSV contains cost and duration columns
    And the CSV contains evaluator result columns (score, passed, details)

  Scenario: CSV handles special characters
    Given the dataset contains text with commas, quotes, and newlines
    When I export to CSV
    Then special characters are properly escaped
    And the CSV can be opened correctly in spreadsheet software

  # ============================================================================
  # Empty and Loading States
  # ============================================================================

  Scenario: Show loading skeleton while fetching results
    Given the results are still loading
    When the page renders
    Then I see skeleton placeholders for the table
    And I see skeleton placeholders for the tabs

  Scenario: Show empty state when no results
    Given the evaluation has no results yet
    When the page renders
    Then I see a message "Waiting for the first results to arrive..."

  Scenario: Handle error loading results
    Given the API returns an error when fetching results
    When the page renders
    Then I see an error alert
    And the error message explains what went wrong

  # ============================================================================
  # Backward Compatibility
  # ============================================================================

  Scenario: Display V2 evaluations without targets
    Given an evaluation was run with the old V2 system (no targets)
    When the results table renders
    Then the predicted output is shown in a single column
    And evaluator results are displayed correctly
    And all existing functionality works

  Scenario: Display V3 evaluations with multiple targets
    Given an evaluation was run with V3 system having 3 targets
    When the results table renders
    Then each target has its own column
    And evaluator chips appear under each target's output
    And the layout matches the evaluations-v3 workbench style

  # ============================================================================
  # Optimization Studio Integration
  # ============================================================================

  Scenario: View results in optimization studio panel
    Given I am in the optimization studio
    And I have run an evaluation from a workflow
    When I open the results panel
    Then I see the same batch evaluation results table
    And I can switch between runs
    And I can export to CSV

  Scenario: Open full experiment page from studio
    Given I am viewing results in the optimization studio panel
    When I click "Open Experiment Full Page"
    Then a new tab opens with the full experiment page
    And the same run is selected

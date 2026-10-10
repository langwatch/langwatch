@unit
Feature: Batch Evaluation Results Visualization
  As a user reviewing evaluation results
  I want to see a clear visualization of my evaluation runs
  So that I can understand how my targets performed across the dataset

  # Many scenarios in this file are bound below to existing JSDOM
  # render tests under
  # `[gone] src/components/batch-evaluation-results/__tests__/`:
  #   * BatchEvaluationResultsTable.test.tsx — table rendering +
  #     loading skeleton + empty state + dataset/target columns.
  #   * BatchTargetCell.test.tsx — output display + cost/duration,
  #     error state, truncation, evaluator chips (pass/fail/error).
  #   * BatchSummaryFooter.test.tsx — run summary + cost.
  #   * BatchRunsSidebar.integration.test.tsx — list of runs.
  #   * isRunFinished.test.ts — running / stopped indicator.
  #   * csvExport.test.ts — CSV export + special characters.
  #
  # Remaining scenarios that stay `@unimplemented` describe page-
  # level integration flows (image rendering in cells, evaluator
  # chip hover tooltip, "View Trace" link conditional render,
  # Studio panel "Open full experiment" button, comparison-mode
  # toggles, V2-vs-V3 page wiring) that need either a top-level
  # render fixture for the experiment page or a Playwright suite.
  # See specs/batch-evaluation-results/AUDIT_MANIFEST.md for the
  # full classification.

  Background:
    Given I am on the experiment results page
    And an evaluation run has completed

  # ============================================================================
  # Data Display - Dataset Columns
  # ============================================================================

  @unimplemented
  Scenario: Display dataset columns in the table
    Given the evaluation was run on a dataset with columns "input", "expected_output"
    When the results table renders
    Then I see columns for each dataset field
    And the "input" column shows the original dataset values
    And the "expected_output" column shows the expected values

  @unimplemented
  Scenario: Display images in dataset columns
    Given the dataset has a column with image URLs
    When the results table renders
    Then images are rendered inline in the dataset cells
    And images have appropriate max dimensions for the table

  @unimplemented
  Scenario: Truncate long text in dataset cells
    Given a dataset cell contains text longer than 10000 characters
    When the results table renders
    Then the text is truncated with a "(truncated)" indicator
    And I can click to expand and see more of the content

  # ============================================================================
  # Data Display - Target Columns
  # ============================================================================

  @unimplemented
  Scenario: Display target output columns
    Given the evaluation has 2 targets "GPT-4o" and "Claude"
    When the results table renders
    Then I see a column for each target
    And the column header shows the target name
    And each row shows the output from that target

  @unimplemented
  Scenario: Display target output with cost and duration
    Given a target produced output with cost $0.001 and latency 1.2s
    When I hover over the target cell
    Then I see the latency displayed
    And I can access cost information

  # A saved run holds only the rows it produced, so its pass rate covers those
  # rows and no others. The results page draws the rate on the column header
  # with nothing to say how much of the dataset it describes, and a reader then
  # compares one column over 30 rows against another over 40. The workbench
  # header says the same thing the same way, so the two surfaces read alike.

  @integration
  Scenario: A column header says how much of the dataset its score covers
    Given a saved run holds results for 5 of the dataset's 10 rows
    When the results table renders the column header
    Then the header shows the score together with "5/10"

  @integration
  Scenario: A column that covers the whole dataset shows the score on its own
    Given a saved run holds results for every row of the dataset
    When the results table renders the column header
    Then the header shows the score with no row count beside it

  @unimplemented
  Scenario: Display error state in target cell
    Given a target execution failed with error "Rate limit exceeded"
    When the results table renders
    Then the target cell shows an error indicator
    And the error message "Rate limit exceeded" is visible

  Scenario: Reveal full error message on hover
    Given a target execution failed with an error longer than two lines
    When the results table renders
    Then the error cell clamps the message to two lines
    When I hover over the error cell
    Then a tooltip shows the full error message

  Scenario: Expand full error message on click
    Given a target execution failed with an error longer than two lines
    When I click on the error cell
    Then the error expands into an overlay showing the full message
    And I can dismiss the expanded view by clicking outside or by pressing Escape

  @unimplemented
  Scenario: Expand long target output
    Given a target output is longer than the cell's collapsed height
    When the results table renders
    Then a fade overlay appears at the bottom of the cell
    When I click on the cell
    Then the output expands to show the full content
    And I can dismiss the expanded view by clicking outside or by pressing Escape

  # ============================================================================
  # Evaluator Results Display
  # ============================================================================

  @unimplemented
  Scenario: Display evaluator chips below target output
    Given a target has 2 evaluators "Exact Match" and "LLM as Judge"
    And both evaluators have completed
    When the results table renders
    Then I see evaluator chips below the target output
    And each chip shows the evaluator name and result

  @unimplemented
  Scenario: Evaluator chip shows pass status
    Given an evaluator "Exact Match" passed with score 1.0
    When the results table renders
    Then the evaluator chip shows a green indicator
    And the chip displays "passed"

  @unimplemented
  Scenario: Evaluator chip shows fail status
    Given an evaluator "Exact Match" failed with score 0.0
    When the results table renders
    Then the evaluator chip shows a red indicator
    And the chip displays "failed"

  @unimplemented
  Scenario: Evaluator chip shows error status
    Given an evaluator execution failed with an error
    When the results table renders
    Then the evaluator chip shows an error indicator
    And hovering shows the error details

  @unimplemented
  Scenario: Evaluator chip hover shows details
    Given an evaluator "LLM as Judge" completed with score 0.75 and details
    When I hover over the evaluator chip
    Then I see the full score
    And I see the evaluation details/reasoning

  # ============================================================================
  # Fields / Row Height
  # ============================================================================
  # A "Fields" control in the results header lets users toggle which target
  # details render — outputs, scores, and latency/cost — independently of
  # each other. A separate "Row height" control changes how much of each
  # cell's content is visible before it needs expanding. Dataset columns stay
  # controlled by the separate column-visibility popover. Field choices reset
  # on reload — a hidden section left on from a previous visit should never
  # silently explain "no results" on a different run.

  Scenario: Hide scores to focus on outputs
    Given an evaluation run with target outputs and evaluator score chips
    When I turn off the "Scores" field
    Then the target outputs remain visible
    And the evaluator score chips are hidden

  Scenario: Hide outputs to focus on scores
    Given an evaluation run with target outputs and evaluator score chips
    When I turn off the "Outputs" field
    Then the evaluator score chips remain visible
    And the target outputs are hidden

  Scenario: Hide cost and latency to reduce clutter
    Given a target produced output with a cost and a latency
    When I turn off the "Latency and cost" field
    Then the cost and latency are hidden
    And the target output remains visible

  Scenario: Hide the target column when no fields are shown
    Given an evaluation run with a target column
    When I turn off the outputs, scores, and latency and cost fields
    Then the target column is removed from the table
    And the dataset columns remain visible

  Scenario: Field visibility does not persist across reloads
    Given I have turned off the "Scores" field
    When I reload the page
    Then all fields are shown again

  Scenario: Increase row height to see more of a long output before expanding
    Given a target output long enough to be clipped at the default row height
    When I switch the row height to "Large"
    Then more of the output is visible without expanding the cell

  Scenario: Row height choice persists across reloads
    Given I have switched the row height to "Large"
    When I reload the page
    Then the row height is still "Large"

  # ============================================================================
  # Trace Links
  # ============================================================================

  @unimplemented
  Scenario: View trace for a target execution
    Given a target execution has an associated trace_id
    When I hover over the target cell
    Then I see a "View Trace" button
    When I click the "View Trace" button
    Then a trace drawer opens showing execution details

  @unimplemented
  Scenario: No trace link when no trace_id
    Given a target execution has no trace_id
    When the results table renders
    Then no "View Trace" button is shown for that cell

  # ============================================================================
  # Run Selection Sidebar
  # ============================================================================

  @unimplemented
  Scenario: Display list of evaluation runs
    Given there are 3 completed evaluation runs
    When I view the experiment page
    Then I see a sidebar with all 3 runs listed
    And runs are ordered by timestamp (most recent first)
    And the most recent run is selected by default

  @unimplemented
  Scenario: Run shows summary information
    Given an evaluation run completed with 2 evaluators
    When I view the runs sidebar
    Then each run shows the timestamp
    And each run shows a summary of evaluator scores
    And each run shows the total cost

  @unimplemented
  Scenario: Select a different run
    Given I am viewing run 1
    And run 2 exists in the sidebar
    When I click on run 2 in the sidebar
    Then the results table updates to show run 2 results
    And run 2 is highlighted as selected

  @unimplemented
  Scenario: Show running indicator for in-progress run
    Given an evaluation is currently running
    When I view the runs sidebar
    Then the running evaluation shows a spinner
    And results update in real-time as they arrive

  @unimplemented
  Scenario: Show stopped indicator for stopped run
    Given an evaluation was manually stopped
    When I view the runs sidebar
    Then the stopped run shows a red indicator
    And partial results are still viewable

  # ============================================================================
  # CSV Export
  # ============================================================================

  @unimplemented
  Scenario: Export results to CSV
    Given I am viewing an evaluation run with results
    When I click the "Export to CSV" button
    Then a CSV file is downloaded
    And the filename includes the experiment name and date

  @unimplemented
  Scenario: CSV contains all columns
    Given the evaluation has dataset columns, target outputs, and evaluator results
    When I export to CSV
    Then the CSV contains dataset columns
    And the CSV contains target output columns
    And the CSV contains cost and duration columns
    And the CSV contains evaluator result columns (score, passed, details)

  # A comparison grades no single target, so it has no per-target column to ride
  # in. Without a block of its own the export silently loses the verdict, and
  # the reader sees every candidate's output with no record of which one won.
  @unit
  Scenario: CSV contains the comparison verdict
    Given the evaluation ran a comparison over several targets
    When I export to CSV
    Then each comparison has a winner, candidates and reasoning column
    And the winner column names the winning target, or reads tie
    And a row the judge did not call leaves those columns empty

  @unimplemented
  Scenario: CSV handles special characters
    Given the dataset contains text with commas, quotes, and newlines
    When I export to CSV
    Then special characters are properly escaped
    And the CSV can be opened correctly in spreadsheet software

  # ============================================================================
  # Empty and Loading States
  # ============================================================================

  @unimplemented
  Scenario: Show loading skeleton while fetching results
    Given the results are still loading
    When the page renders
    Then I see skeleton placeholders for the table
    And I see skeleton placeholders for the tabs

  @unimplemented
  Scenario: Show empty state when no results
    Given the evaluation has no results yet
    When the page renders
    Then I see a message "Waiting for the first results to arrive..."

  @unimplemented
  Scenario: Handle error loading results
    Given the API returns an error when fetching results
    When the page renders
    Then I see an error alert
    And the error message explains what went wrong

  # ============================================================================
  # Backward Compatibility
  # ============================================================================

  @unimplemented
  Scenario: Display V2 evaluations without targets
    Given an evaluation was run with the old V2 system (no targets)
    When the results table renders
    Then the predicted output is shown in a single column
    And evaluator results are displayed correctly
    And all existing functionality works

  @unimplemented
  Scenario: Display V3 evaluations with multiple targets
    Given an evaluation was run with V3 system having 3 targets
    When the results table renders
    Then each target has its own column
    And evaluator chips appear under each target's output
    And the layout matches the evaluations-v3 workbench style

  # ============================================================================
  # Optimization Studio Integration
  # ============================================================================

  @unimplemented
  Scenario: View results in optimization studio panel
    Given I am in the optimization studio
    And I have run an evaluation from a workflow
    When I open the results panel
    Then I see the same batch evaluation results table
    And I can switch between runs
    And I can export to CSV

  @unimplemented
  Scenario: Open full experiment page from studio
    Given I am viewing results in the optimization studio panel
    When I click "Open Experiment Full Page"
    Then a new tab opens with the full experiment page
    And the same run is selected

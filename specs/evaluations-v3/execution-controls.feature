Feature: Evaluation Execution Controls
  As a user of the Evaluations V3 workbench
  I want to control evaluation execution from multiple entry points
  So that I can run evaluations at different granularity levels

  Background:
    Given I am on the Evaluations V3 workbench
    And I have a dataset with 3 rows
    And I have 2 targets configured with valid mappings
    And I have 1 evaluator configured for each target

  # ===========================================================================
  # Top-Level Run Button
  # ===========================================================================

  Scenario: Run button executes all targets and rows
    When I click the top-right "Run" button
    Then execution starts for all 6 cells (3 rows × 2 targets)
    And the "Run" button becomes a "Stop" button
    And progress indicator shows "0/6"
    And all cells show loading skeletons

  Scenario: Stop button aborts execution
    Given an evaluation is running
    When I click the "Stop" button
    Then execution stops
    And partial results are preserved
    And the button returns to "Run" state

  Scenario: Run button validates mappings before execution
    Given a target has missing required mappings
    When I click the "Run" button
    Then the target editor drawer opens
    And I can see the missing mapping highlighted
    And execution does not start

  # ===========================================================================
  # Target Header Run Button
  # ===========================================================================

  Scenario: Target header run button executes all rows for that target
    When I click the play button on target "Target 1" header
    Then execution starts for 3 cells (all rows for Target 1)
    And the target header play button becomes a stop button
    And only Target 1 cells show loading skeletons
    And Target 2 cells are unchanged

  Scenario: Target header stop button stops execution
    Given Target 1 is being executed
    When I click the stop button on target "Target 1" header
    Then execution stops
    And partial Target 1 results are preserved
    And the button returns to play state

  Scenario: Can run multiple targets independently
    Given Target 1 is being executed
    When I click the play button on target "Target 2" header
    Then execution starts for Target 2 as well
    And both targets show running state
    And top-level button shows stop

  # ===========================================================================
  # Cell-Level Run Button
  # ===========================================================================

  Scenario: Cell run button appears on hover
    When I hover over a target cell
    Then a small play button appears
    And the button is positioned in the top-right corner

  Scenario: Cell run button executes single cell
    When I hover over row 2, Target 1 cell
    And I click the cell play button
    Then execution starts for that single cell
    And only that cell shows loading skeleton
    And other cells are unchanged

  Scenario: Cell run button becomes stop when running
    Given row 2, Target 1 cell is being executed
    When I hover over that cell
    Then the button shows as a stop button
    When I click the stop button
    Then execution for that cell stops

  # ===========================================================================
  # Selection Toolbar Run Button
  # ===========================================================================

  Scenario: Selection toolbar appears when rows are selected
    When I select rows 1 and 3 using checkboxes
    Then the selection toolbar appears at the bottom
    And it shows "2 selected"
    And it has Run, Delete, and Clear buttons

  Scenario: Selection toolbar run button executes selected rows
    Given I have selected rows 1 and 3
    When I click the "Run" button in the selection toolbar
    Then execution starts for 4 cells (2 rows × 2 targets)
    And only rows 1 and 3 cells show loading skeletons
    And row 2 is unchanged

  Scenario: Selection toolbar shows stop when running
    Given I have selected rows 1 and 3
    And those rows are being executed
    Then the selection toolbar "Run" button becomes "Stop"
    And the "Delete" button is disabled

  Scenario: Selection toolbar stop button aborts execution
    Given selected rows are being executed
    When I click the "Stop" button in the selection toolbar
    Then execution stops
    And partial results for selected rows are preserved

  # ===========================================================================
  # Button State Synchronization
  # ===========================================================================

  Scenario: Top-level button reflects any running execution
    Given no execution is running
    Then the top-level button shows "Run"
    When I start execution from target "Target 1" header
    Then the top-level button becomes "Stop"
    When execution completes
    Then the top-level button returns to "Run"

  Scenario: Top-level stop aborts all running executions
    Given Target 1 is being executed
    And Target 2 is being executed
    When I click the top-level "Stop" button
    Then all executions are aborted
    And all buttons return to their idle state

  Scenario: Progress shows combined count
    Given Target 1 has completed 2/3 rows
    And Target 2 has completed 1/3 rows
    Then the top-level progress shows "3/6"

  # ===========================================================================
  # Empty Row Handling
  # ===========================================================================

  Scenario: Empty rows are skipped in execution
    Given row 2 has all empty values
    When I click the top-level "Run" button
    Then execution starts for 4 cells (2 non-empty rows × 2 targets)
    And row 2 does not show loading skeleton
    And progress shows "0/4"

  Scenario: Explicitly running empty row shows no execution
    Given row 2 has all empty values
    And I have selected only row 2
    When I click the "Run" button in the selection toolbar
    Then execution starts with 0 cells
    And completion is immediate

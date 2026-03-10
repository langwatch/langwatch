Feature: Evaluator Run/Rerun Enhancements
  As a user iterating on evaluator configurations in the evaluations-v3 workbench
  I want to run individual evaluators on single cells and across all rows
  So that I can quickly test and refine evaluator settings without re-running targets

  Background:
    Given the evaluations-v3 workbench is open with a dataset, a target, and an evaluator

  # ---------------------------------------------------------------------------
  # "Run evaluator" for freshly added (pending) evaluators
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Pending evaluator chip shows "Run" when target output exists
    Given the target has already produced output for the current row
    And a new evaluator has been added but not yet run
    When I open the evaluator chip menu
    Then I see a "Run" menu item

  @integration
  Scenario: Pending evaluator chip hides "Run" when no target output exists
    Given no target output exists for the current row
    And a new evaluator has been added but not yet run
    When I open the evaluator chip menu
    Then I do not see a "Run" menu item

  @integration
  Scenario: Running a pending evaluator executes without re-running the target
    Given a pending evaluator on a row that has an existing target output
    When the user triggers "Run" on that evaluator
    Then the evaluator runs using the existing target output
    And the target is not re-executed
    And the evaluator result appears on the same trace

  # ---------------------------------------------------------------------------
  # "Rerun" for already-run evaluators (existing behavior preserved)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Completed evaluator chip shows "Rerun" instead of "Run"
    Given the evaluator has already been run and has a result
    When I open the evaluator chip menu
    Then I see a "Rerun" menu item
    And I do not see a "Run" menu item

  @integration
  Scenario: Running evaluator chip hides both "Run" and "Rerun"
    Given the evaluator is currently running
    When I open the evaluator chip menu
    Then I do not see a "Run" menu item
    And I do not see a "Rerun" menu item

  # ---------------------------------------------------------------------------
  # "Run on all rows" for any evaluator
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Evaluator chip menu shows "Run on all rows" when target outputs exist
    Given at least one row has a target output for this target
    When I open the evaluator chip menu
    Then I see a "Run on all rows" menu item below the Run/Rerun item

  @integration
  Scenario: "Run on all rows" is hidden when no rows have target outputs
    Given no rows have target outputs for this target
    When I open the evaluator chip menu
    Then I do not see a "Run on all rows" menu item

  @integration
  Scenario: "Run on all rows" is hidden while evaluator is running
    Given the evaluator is currently running
    When I open the evaluator chip menu
    Then I do not see a "Run on all rows" menu item

  @integration
  Scenario: "Run on all rows" executes the evaluator only on rows with existing target outputs
    Given rows 0, 1, and 3 have target outputs but row 2 does not
    When the user triggers "Run on all rows" for the evaluator
    Then evaluator execution is triggered for rows 0, 1, and 3
    And row 2 is skipped
    And target outputs are not regenerated for any row

  @integration
  Scenario: "Run on all rows" reuses existing trace IDs
    Given rows have existing target outputs with associated trace IDs
    When the user triggers "Run on all rows" for the evaluator
    Then each evaluator execution reuses the existing trace ID for its row

  @unit
  Scenario: Running evaluator on all rows creates one execution per row with target output
    Given a request to run an evaluator on all rows for a target
    And pre-computed target outputs exist for some rows
    When the execution cells are generated
    Then one cell is created per row that has a pre-computed target output
    And each cell skips target execution
    And each cell includes only the specified evaluator

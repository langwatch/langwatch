@unit
Feature: Undo/Redo in Evaluations Workbench
  As a user editing evaluations
  I want to undo and redo my changes
  So that I can recover from mistakes and explore different approaches

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the dataset has columns "input" and "expected_output"

  # ============================================================================
  # Keyboard Shortcuts
  # ============================================================================

  @unimplemented
  Scenario: Cmd+Z triggers undo when not editing a cell
    Given the dataset has 3 rows
    And I edit cell at row 0, column "input" to "hello"
    And no cell is being edited
    When I press Cmd+Z
    Then the cell at row 0, column "input" is empty

  @unimplemented
  Scenario: Cmd+Shift+Z triggers redo
    Given the dataset has 3 rows
    And I edit cell at row 0, column "input" to "hello"
    And I press Cmd+Z
    When I press Cmd+Shift+Z
    Then the cell at row 0, column "input" displays "hello"

  # ============================================================================
  # Cell Editing - Inline Dataset
  # ============================================================================
  @unimplemented
  Scenario: Multiple sequential undos
    Given the dataset has 3 rows
    When I edit cell at row 0, column "input" to "first"
    And I edit cell at row 0, column "expected_output" to "second"
    And I click the undo button
    Then the cell at row 0, column "expected_output" is empty
    When I click the undo button
    Then the cell at row 0, column "input" is empty

  @unimplemented
  Scenario: Undo clears redo stack when new change is made
    Given the dataset has 3 rows
    And I edit cell at row 0, column "input" to "first"
    And I click the undo button
    When I edit cell at row 0, column "input" to "different"
    Then the redo button is disabled

  # ============================================================================
  # Cell Editing - Saved Dataset with DB Sync
  # ============================================================================

  @unimplemented
  Scenario: Undo cell edit in saved dataset triggers DB sync
    Given I have a saved dataset with records loaded
    And the original value of cell (0, "input") is "original"
    And I edit cell at row 0, column "input" to "new value"
    And the change syncs to the database
    When I click the undo button
    Then the cell at row 0, column "input" displays "original"
    And a sync to the database is triggered with "original"

  @unimplemented
  Scenario: Redo cell edit in saved dataset triggers DB sync
    Given I have a saved dataset with records loaded
    And I edit cell at row 0, column "input" to "new value"
    And I click the undo button
    When I click the redo button
    Then the cell at row 0, column "input" displays "new value"
    And a sync to the database is triggered with "new value"

  # ============================================================================
  # Dataset Management
  # ============================================================================

  @unimplemented
  Scenario: Undo adding a new inline dataset
    Given I have only "Test Data" in the workbench
    When I add a new dataset via "Create new"
    And "Dataset 2" is added to the workbench
    And I click the undo button
    Then "Dataset 2" is removed from the workbench
    And "Test Data" is the active dataset

  @unimplemented
  Scenario: Redo adding a dataset restores it
    Given I have only "Test Data" in the workbench
    And I add a new dataset via "Create new"
    And I click the undo button
    When I click the redo button
    Then "Dataset 2" is in the workbench

  # ============================================================================
  # Row Operations
  # ============================================================================
  @unimplemented
  Scenario: Undo deleting rows in saved dataset triggers DB sync
    Given I have a saved dataset with 3 records
    When I select rows 0 and 1 via checkboxes
    And I click "Delete" in the selection toolbar
    And I confirm the deletion
    And the deletion syncs to the database
    And I click the undo button
    Then the dataset has 3 rows
    And a sync to restore the rows is triggered

  # ============================================================================
  # Rapid Changes Batching
  # ============================================================================

  @unimplemented
  Scenario: Rapid cell edits are batched into single undo entry
    Given the dataset has 3 rows
    When I type "hello" in cell (0, "input") character by character within 100ms
    And I click outside the cell
    And I click the undo button
    Then the cell at row 0, column "input" is empty

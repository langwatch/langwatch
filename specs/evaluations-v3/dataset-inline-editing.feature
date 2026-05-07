@unit
Feature: Dataset inline editing
  As a user configuring an evaluation
  I want to edit dataset values directly in the spreadsheet
  So that I can quickly create and modify test data

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the dataset has columns "input" and "expected_output"

  @unimplemented
  Scenario: Select a cell by single-clicking
    Given the dataset has 3 rows
    When I click the cell at row 0, column "input"
    Then the cell shows a blue selection outline
    And no other cells have the selection outline

  @unimplemented
  Scenario: Edit a selected cell by pressing Enter or double-clicking
    Given the dataset has 3 rows
    And the cell at row 0, column "input" is selected
    When I press Enter
    Then the cell enters edit mode with an expanded textarea
    And the textarea is positioned directly over the cell

  @unimplemented
  Scenario: Cancel cell edit with Escape
    Given the dataset has 3 rows
    And row 0 has "input" value "original"
    When I double-click the cell at row 0, column "input"
    And I type "modified"
    And I press Escape
    Then the cell at row 0, column "input" displays "original"

  @unimplemented
  Scenario: Confirm cell edit with Enter
    Given the dataset has 3 rows
    And row 0 has "input" value "original"
    When I double-click the cell at row 0, column "input"
    And I type "modified"
    And I press Enter
    Then the cell at row 0, column "input" displays "modified"

  @unimplemented
  Scenario: Navigate to next cell with Tab while editing
    Given the dataset has 3 rows
    When I double-click the cell at row 0, column "input"
    And I type "value1"
    And I press Tab
    Then the cell at row 0, column "expected_output" is selected

  @unimplemented
  Scenario: Navigate with arrow keys
    Given the dataset has 3 rows
    And the cell at row 0, column "input" is selected
    When I press ArrowRight
    Then the cell at row 0, column "expected_output" is selected
    When I press ArrowDown
    Then the cell at row 1, column "expected_output" is selected
    When I press ArrowLeft
    Then the cell at row 1, column "input" is selected
    When I press ArrowUp
    Then the cell at row 0, column "input" is selected

  @unimplemented
  Scenario: Enter edit mode with Enter key
    Given the dataset has 3 rows
    And the cell at row 0, column "input" is selected
    When I press Enter
    Then the cell at row 0, column "input" is in edit mode

  @unimplemented
  Scenario: Clear selection with Escape
    Given the dataset has 3 rows
    And the cell at row 0, column "input" is selected
    When I press Escape
    Then no cell is selected

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

  @unimplemented
  Scenario: Undo cell edit with keyboard shortcut
    Given the dataset has 3 rows
    And row 0 has "input" value "original"
    When I double-click the cell at row 0, column "input"
    And I type "modified"
    And I click outside the cell
    And I press Cmd+Z
    Then the cell at row 0, column "input" displays "original"

  @unimplemented
  Scenario: Redo cell edit with keyboard shortcut
    Given the dataset has 3 rows
    And row 0 has "input" value "original"
    When I edit cell at row 0, column "input" to "modified"
    And I press Cmd+Z
    And I press Cmd+Shift+Z
    Then the cell at row 0, column "input" displays "modified"

  @unimplemented
  Scenario: Delete selected rows shows confirmation
    Given the dataset has 3 rows
    And rows 0 and 2 are selected via checkboxes
    When I click the "Delete" button in the selection toolbar
    Then a confirmation dialog appears asking "Delete 2 rows?"

  @unimplemented
  Scenario: Confirm row deletion
    Given the dataset has 3 rows
    And rows 0 and 2 are selected via checkboxes
    And I click the "Delete" button in the selection toolbar
    When I click "Delete" in the confirmation dialog
    Then rows 0 and 2 are removed from the dataset
    And the dataset now has 1 row
    And the row selection is cleared

  @unimplemented
  Scenario: Cancel row deletion
    Given the dataset has 3 rows
    And rows 0 and 2 are selected via checkboxes
    And I click the "Delete" button in the selection toolbar
    When I click "Cancel" in the confirmation dialog
    Then all 3 rows remain in the dataset
    And rows 0 and 2 are still selected

  @unimplemented
  Scenario: Deleting all rows preserves one empty row
    Given the dataset has 3 rows
    And all 3 rows are selected via the header checkbox
    When I click the "Delete" button in the selection toolbar
    And I confirm the deletion
    Then the dataset has 1 empty row
    And I can continue adding data to the empty row

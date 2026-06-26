Feature: Dataset editor
  As a user managing datasets
  I want a fast spreadsheet-like editor for dataset records
  So that I can view and edit my data inline without fighting the grid

  # The same editor is used everywhere a dataset is edited: the dataset
  # detail page, the workflow dataset node, prompt demonstrations, and the
  # evaluations workbench. One experience, no parallel implementations.

  Background:
    Given I have a dataset with columns "input" and "expected_output"
    And the dataset has some records

  # ============================================================================
  # Viewing
  # ============================================================================

  @integration
  Scenario: Records render in a spreadsheet table
    When I open the dataset in the editor
    Then I see one row per record
    And I see one column per dataset column
    And long cell values are clamped with a fade instead of stretching the row

  @integration @unimplemented
  Scenario: Large datasets stay responsive
    Given the dataset has thousands of records
    When I open the dataset in the editor
    Then only the visible rows are rendered
    And scrolling through the dataset stays smooth

  # ============================================================================
  # Pagination
  # ============================================================================
  # A dataset larger than one page is read a page at a time instead of loading
  # the whole thing into the browser (which previously stopped at a byte cap and
  # silently hid the rest). The editor shows one page of records with a pager;
  # editing still works on the visible page because edits target each record by
  # its own id.

  @integration
  Scenario: A dataset larger than one page shows the first page with a pager
    Given the dataset has more records than fit on one page
    When I open the dataset in the editor
    Then I see the first page of records
    And I see which page I am on and how many pages there are
    And the total record count reflects the whole dataset, not just this page

  @integration
  Scenario: Move between pages
    Given the dataset has more records than fit on one page
    When I open the dataset in the editor
    And I go to the next page
    Then I see the next page of records
    And I can return to the previous page

  @integration
  Scenario: Edits on a page are saved to the right record
    Given the dataset has more records than fit on one page
    When I move to a later page
    And I edit a cell on that page
    Then the change is saved to that record
    And it is still there when I return to that page

  @integration
  Scenario: A new row is added on the last page
    Given the dataset has more records than fit on one page
    When I go to the last page
    Then an empty row to add a record is available there
    And it is not offered on earlier, full pages

  # ============================================================================
  # Inline cell editing
  # ============================================================================

  @integration
  Scenario: Edit a cell inline
    When I double-click a cell
    Then an editor opens over the cell with the current value
    When I type a new value and press Enter
    Then the cell shows the new value

  @integration
  Scenario: Escape cancels a cell edit
    When I double-click a cell and type a new value
    And I press Escape
    Then the cell keeps its original value

  @integration
  Scenario: Boolean cells validate input
    Given the dataset has a "passed" column of type boolean
    When I edit a "passed" cell and enter "maybe"
    Then the editor shows that the value is invalid
    And the value is not saved until corrected

  @integration
  Scenario: Number cells validate input
    Given the dataset has a "score" column of type number
    When I edit a "score" cell and enter "abc"
    Then the editor shows that the value is invalid
    And the value is not saved until corrected

  # ============================================================================
  # Autosave
  # ============================================================================

  @integration
  Scenario: Cell edits autosave to the dataset
    When I edit a cell and press Enter
    Then the change is saved to the dataset automatically
    And the editor shows a saving indicator while the save is in flight
    And the indicator confirms when the save completes

  @integration
  Scenario: A failed save is visible, never silent
    Given saving to the server fails
    When I edit a cell and press Enter
    Then the editor shows that saving failed
    And my edit is not silently discarded

  # ============================================================================
  # Rows
  # ============================================================================

  @integration
  Scenario: Add a new row
    When I click "Add row"
    Then an empty row appears at the bottom of the table
    And no cell is forced into edit mode

  @integration
  Scenario: Select and delete rows
    When I select two rows with their checkboxes
    And I delete the selected rows
    Then the rows are removed from the table
    And the deletion is saved to the dataset

  # Rows added in the editor persist to the database under their
  # client-generated id, so deleting them must send a real server deletion
  # too. Treating any client-generated id as "never saved" left deleted rows
  # in the database and they reappeared on reload.
  @integration
  Scenario: Deleting a row that was added and saved in the editor persists
    Given I added a row and gave it a value so it saved to the dataset
    When I select that row and delete it
    Then a server deletion is queued for that row
    And the row does not reappear when the dataset is reopened

  # ============================================================================
  # Columns
  # ============================================================================

  @integration @unimplemented
  Scenario: Edit columns from the editor
    When I open the column editor
    And I add a column "context" of type string
    And I save
    Then the table shows the new "context" column
    And the column change is saved to the dataset

  @integration @unimplemented
  Scenario: Saving column changes never fails silently
    Given saving column changes is blocked for any reason
    When I save the column editor
    Then I see why the save did not happen
    And the editor does not pretend the save succeeded

  # ============================================================================
  # CSV
  # ============================================================================

  @integration @unimplemented
  Scenario: Add rows from a CSV file
    When I upload a CSV file with matching columns
    Then the rows from the file are appended to the dataset

  @integration @unimplemented
  Scenario: Download the dataset as CSV
    When I download the dataset as CSV
    Then I get a CSV file with all columns and records

  # ============================================================================
  # Running an experiment
  # ============================================================================
  # The legacy Batch Evaluation drawer is gone. The editor offers a single
  # Run experiment action that seeds the evaluations workbench with this
  # dataset, the same workbench used everywhere else.

  @integration
  Scenario: Run an experiment from a dataset
    Given I am editing a saved dataset
    When I click "Run experiment"
    Then I am taken to a new experiment workbench seeded with this dataset

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

  @integration
  Scenario: Change how many rows are shown per page
    Given the dataset has more records than fit on one page
    When I change how many rows are shown per page
    Then that many records are loaded
    And I am returned to the first page

  # ============================================================================
  # Searching rows
  # ============================================================================
  # Paging is how you read a dataset in order; it is a poor way to find one row
  # among hundreds. Search narrows the dataset to the rows whose cell values
  # contain what was typed, and the pager then pages the matches.
  #
  # The narrowing happens over the whole dataset, not over the page already on
  # screen: a search that could only find rows the user can already see would
  # not be worth having. That is what the first scenario pins — the matched
  # record starts on a page that was never loaded.

  @integration
  Scenario: Find a record that is not on the page I am looking at
    Given the dataset has more records than fit on one page
    And the only record containing "escalation" is on the last page
    When I open the dataset in the editor
    And I search for "escalation"
    Then I see that record without leaving the first page
    And I see only the records containing "escalation"

  @unit
  Scenario: Search matches regardless of letter case
    Given a record contains "Escalation"
    When I search for "escalation"
    Then that record is shown

  @integration
  Scenario: The record count reports the matches, not the whole dataset
    Given the dataset has more records than fit on one page
    When I search for something matching fewer records than the whole dataset
    Then the record count tells me how many records matched
    And it tells me how many records the dataset holds in total
    # Both numbers, because either alone is a trap: the match count alone reads
    # as the dataset having shrunk, and the total alone hides the result of the
    # search that was just run.

  @integration
  Scenario: The pager pages the matches
    Given a search matches more records than fit on one page
    Then the pager offers one page per page of matches
    And moving to the next page shows the next page of matches

  @integration
  Scenario: Searching returns me to the first page of results
    Given the dataset has more records than fit on one page
    When I go to a later page
    And I search for something that matches many records
    Then I am shown the first page of the matches

  @integration
  Scenario: Clearing the search restores the whole dataset
    Given I have searched for "escalation"
    When I clear the search
    Then I see the whole dataset again
    And the record count reports the whole dataset again
    # Deliberately says nothing about which page you land on. That is settled by
    # "Clearing the search offers adding rows again", which requires the page you
    # searched FROM. An unconditional "and I am on the first page" here
    # contradicted that scenario, and was false about the editor as built.

  @integration
  Scenario: A search that matches nothing says so in the grid
    When I search for something no record contains
    Then the grid tells me no records match what I searched for
    And it repeats what I searched for, so I can see what was actually run
    And the row count reads zero matches

  Rule: Search matches the cell values, not the column names

    A row is a match when one of its values contains the text. Matching the
    column names too would make searching "id" return every row of a dataset
    with a "conversation_id" column — a result the user cannot explain from
    what is on screen.

    @unit
    Scenario: A word that only appears in a column name matches nothing
      Given the dataset has a column named "escalation"
      And no record contains the word "escalation" in any of its values
      When I search for "escalation"
      Then no records match

  Rule: A search never strands an unsaved edit

    Changing the search reloads the grid from the server, which drops the rows
    the previous search returned. An edit still on its way to being saved refers
    to one of those rows, so it would be discarded with nothing shown to the
    user — and the editor would go on believing a save was still pending. The
    editor already blocks page navigation for this reason; searching moves the
    same rows and gets the same gate.

    @integration
    Scenario: Searching waits for a pending save
      Given I have edited a cell and the save has not finished
      Then I cannot change the search until it has
      And once it has saved I can search again

  Rule: Changing the search clears the row selection

    Rows are selected by their position in the grid. A search replaces which
    records occupy those positions, so a selection made before it would, after
    it, name different records — and deleting would delete rows the user never
    picked. Paging already clears the selection for this reason.

    @integration
    Scenario: A selection made before a search does not survive it
      Given I have selected a row
      When I search for something that matches different records
      Then nothing is selected
      And I am not offered the delete action for rows I can no longer see

  Rule: Rows cannot be added while a search is active

    Every way of adding a row appends an empty or unrelated row to the end of
    the dataset, which by construction does not match the search — so it would
    be created and immediately vanish. All three ways are withdrawn together:
    the add-row button, the trailing empty row at the end of the grid, and
    adding rows from a CSV file. All three return once the search is cleared.

    @integration
    Scenario: No way to add a row is offered during a search
      When I search for "escalation"
      Then the add-row button is not offered
      And the trailing empty row is not shown
      And adding rows from a CSV file is not offered

    @integration
    Scenario: An import already open when the search lands is withdrawn too
      Given I have opened the CSV import
      When a search takes effect
      Then the import is withdrawn
      # Withdrawing only the button leaves the door open behind it: the search
      # box waits for a pause in typing, so a click landing in that pause opens
      # the import while no search is in effect yet. Rows imported through it
      # land at the end of the dataset, outside the matches on screen.

    @integration
    Scenario: Clearing the search offers adding rows again
      Given I have searched for "escalation"
      When I clear the search
      Then I am offered the ways to add a row that I had before searching
      # "That I had" is the whole assertion: the add-row button and trailing row
      # live on the LAST page, so returning the user to page 1 rather than the
      # page they searched from withdraws them for the rest of the session. A
      # search must not cost the user their place.

  Rule: A dataset too large to scan is refused, not half-searched

    Finding matches means reading the dataset's rows. Past a number of rows the
    platform will read for one search, returning the matches found so far would
    be a wrong answer wearing the clothes of a right one — the user cannot tell
    an empty result from an abandoned scan. The search is refused with its own
    reason, distinct from the one shown when a dataset is too large to export.

    @unit
    Scenario: A dataset over the row limit refuses the search
      Given a dataset with more rows than one search will read
      When a search is run against it
      Then the search is refused as too large to search
      And no partial set of matches is returned

    @unit
    Scenario: The refusal has its own words, not the export refusal's
      Given a search was refused because the dataset is too large
      Then the user is told the dataset is too large to search
      And is not told something about exporting instead
      # Separate codes because the message registry is keyed by code: reusing
      # the export refusal would answer a search with export copy.

    @integration
    Scenario: A refused search does not leave unsearched rows on screen as if they matched
      Given I am looking at a dataset
      When I search it and the search is refused
      Then the rows I was looking at before the search are withdrawn
      And the record count does not report a number of matches
      # The rows on screen were read BEFORE the search and never matched
      # against it. Left in place under a search box, with a count chip
      # reporting them, the screen reads as a finished search that found them —
      # a wrong answer wearing the clothes of a right one, which is the same
      # failure this Rule refuses a partial scan to avoid. The refusal is
      # announced once in a toast that dismisses; what is left on screen has to
      # go on being true after it does.

  Rule: Search is offered for saved datasets only

    Search narrows a dataset by asking the server for the matching rows. A
    dataset being drafted in the editor has never been saved, so there is no
    server to ask and every row is already on screen — the affordance would
    promise something it could not do. The draft editor keeps its unfiltered
    grid and its ways of adding rows.

    KNOWN GAP: the workflow dataset modal opens saved datasets and drafts
    through the same dialog, so the search box appears in one and not the other
    with nothing on screen explaining the difference. Closing it means selecting
    rows by identity rather than by grid position, which is a larger change than
    this one.

    @integration
    Scenario: A draft dataset offers no search
      Given I am editing a dataset that has not been saved
      Then I am not offered a way to search it
      And I am still offered the ways to add a row

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

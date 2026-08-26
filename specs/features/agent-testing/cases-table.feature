Feature: The test cases table
  As a person who owns a set of agent test cases
  I want one table with my cases grouped by suite
  So that I can author them and reach anything with a click

  Background: what a row shows.
    A row shows the name of the test case and its labels as small pastel
    pills. A Run button, an Edit button and a row menu sit at the end of the
    row. The row carries no author, no date and no version. The row carries
    no last result: the table is authoring only, and the last run of a case
    is reached from the row menu or on the Results tab.

    All test cases reads like a code host root. The test suites sit on top as
    folder rows in alphabetical order, and the cases filed in no test suite
    sit below as loose rows at the root. Under a single suite the rows are
    flat.

    A summary line under the table says when the whole set last ran and how
    it did.

  # --- Grouping ---

  @integration
  Scenario: All test cases lists the test suites on top and the loose cases below
    Given two test suites holding cases, and three cases with no test suite
    When All test cases is opened
    Then the test suites read as folder rows on top in alphabetical order
    And the loose cases read as their own rows below the folder rows
    And no folder row expands the cases it holds

  @integration
  Scenario: A folder row shows only the folder name and case count
    Given a test suite holding three cases
    When All test cases is opened
    Then the folder row of that suite reads only the folder name and how many cases it holds
    And no result summary sits on the folder row

  @integration
  Scenario: Clicking a suite folder row opens that suite
    Given the All test cases surface with two test suites
    When one of the folder rows is clicked
    Then that suite's surface opens

  @integration
  Scenario: The panel title reads Test suites when at least one suite exists
    Given the All test cases surface with at least one test suite
    When the panel header is read
    Then the title reads "Test suites"
    And the count that follows reads the total of every case, folder and loose

  @integration
  Scenario: Zero suites renders no folder rows and no Test suites section header
    Given a project with no test suites and a few loose cases
    When All test cases is opened
    Then no folder row is rendered
    And no "Test suites" section header is rendered
    And the loose cases read as their own rows

  @integration
  Scenario: A single suite view lists its rows without group headings
    Given a test suite holding three cases
    When that suite is chosen in the rail
    Then the three rows are listed with no group heading

  # --- Row content ---

  @integration
  Scenario: The cases table shows the test case column and the row actions, and no last result
    Given a test case whose last run passed
    When the cases table is read
    Then the header carries only a Test case column
    And no row carries a last result cell

  @integration
  Scenario: Labels are shown as small pastel pills beside the name
    Given a test case with the labels "critical" and "billing"
    When its row is read
    Then both labels are shown as pills beside the name
    And each label gets its own pill colour

  # --- Row actions ---

  @integration
  Scenario: Every row carries an outlined Run button with the word Run
    Given a test case row
    When the end of the row is read
    Then an outlined button reading "Run" is shown
    And it carries the play icon

  @integration
  Scenario: The row menu offers Edit, Duplicate, Open last run, Move to suite..., History and Archive in order
    Given a test case row with a finished run
    When its row menu is opened
    Then the actions read, in order: "Edit", "Duplicate", "Open last run", "Move to suite...", "History", "Archive"

  @integration
  Scenario: Move to suite... on a row starts checkbox selection with that row pre-checked
    Given a test case row
    When "Move to suite..." is chosen from the row menu
    Then the cases table shows a checkbox on every row
    And the checkbox on that row is pre-checked
    And a selection action bar names the count and offers one "Move to suite" action

  @integration
  Scenario: Move to suite... confirms a bulk move to another suite
    Given a checkbox selection of one test case
    When "Move to suite" is clicked in the selection action bar
    And a target test suite is picked from the dialog
    Then every selected test case is moved to the target test suite
    And the selection clears

  @integration
  Scenario: Move to suite... unfiles when 'No test suite' is picked
    Given a checkbox selection of one test case
    When "Move to suite" is clicked in the selection action bar
    And "No test suite" is picked from the dialog
    Then every selected test case is unfiled

  @integration
  Scenario: Open last run is not offered for a case that never ran
    Given a test case with no run
    When its row menu is opened
    Then "Open last run" is not offered

  @integration
  Scenario: Duplicate creates a copy in the same suite
    Given a test case in the suite "Refunds"
    When "Duplicate" is chosen
    Then a copy appears in the "Refunds" group
    And the copy carries the content of the original

  @integration
  Scenario: Archive asks for confirmation and names the case
    Given a test case row
    When "Archive" is chosen
    Then a confirmation dialog names the case
    And confirming removes the row from the table

  # --- Row click ---

  @integration
  Scenario: Clicking a row opens the case editor
    Given a test case whose last run finished
    When its row is clicked
    Then the case editor opens for that case
    And the run detail drawer does not open

  @integration
  Scenario: Clicking a row with no last run opens the case editor
    Given a test case with no run in the period
    When its row is clicked
    Then the case editor opens for that case

  # --- The case editor ---

  @integration
  Scenario: New test case opens the case dialog straight away
    Given the Agent Testing page is open
    When "New test case" is chosen
    Then the case dialog opens titled "New test case"
    And it asks for a title, a test suite, a situation and the criteria
    And no step asks to write the case with a model first

  @integration
  Scenario: The case dialog footer holds the labels, Save and Save and Run
    Given the case dialog is open
    When its footer is read
    Then the labels of the case sit on the left
    And "Save" and "Save & Run" sit on the right

  @integration
  Scenario: Editing a case names its version and opens the history
    Given a test case at version 4
    When its editor is opened
    Then the dialog is titled "Edit test case"
    And the header offers "v4 · History"
    And choosing it opens the version history

  @integration
  Scenario: Save and Run saves the case and then asks what to run it against
    Given the case dialog holds a title and one criterion
    When "Save & Run" is chosen
    Then the case is saved
    And the run dialog opens for the case that was saved

  # --- Customize test case ---

  @integration
  Scenario: The parameters, the turn limits and the models wait behind chips
    Given the case dialog is open
    When the body is read
    Then the parameters, the simulator model, the judge and the turn limits are not shown
    And a "Customize test case" section offers "Add parameters", "Define min and max turns" and "Override models"

  @integration
  Scenario: A chip opens its block and the block can be removed again
    Given the case dialog is open
    When "Define min and max turns" is chosen
    Then the min and the max turn fields are added to the form
    And the chip is no longer offered
    And removing the block takes the fields away and offers the chip again

  @integration
  Scenario: Editing a case opens the blocks it already uses
    Given a stored case with parameters and a judge model of its own
    When its editor is opened
    Then the parameters block is open on the values of the case
    And the model overrides block is open on that judge
    And the turn limits stay behind their chip

  @integration
  Scenario: Clicking the Run button does not open the row
    Given a test case row with a last run
    When the Run button is clicked
    Then the run dialog opens
    And the run detail drawer does not open

  # --- Filtering ---

  @integration
  Scenario: The label filter narrows the table to one label
    Given cases with the labels "critical", "billing" and "edge"
    When "critical" is chosen in the label filter
    Then only the cases with that label are listed
    And the folder rows that hold none of them are hidden

  # --- The summary line ---

  @integration
  Scenario: A borderless line under the table says when the set last ran
    Given a test suite with a finished run
    When that suite is opened
    Then a line under the table reads when it last ran
    And the date sits directly left of the result of the whole set
    And nothing else sits on the line between them

  @integration
  Scenario: All test cases reads Last full run at
    Given the All test cases view with a finished full run
    When the line under the table is read
    Then it reads "Last full run at" with the date of that run

  # --- External sets ---

  @integration
  Scenario: An external set lists its cases read-only with a last run column
    Given an external set with runs for three named cases
    When the set is chosen in the rail
    Then the three case names are listed
    And each row shows when it last ran
    And no Run button and no row menu are offered

  @integration
  Scenario: Clicking a row of an external set opens its results
    Given an external set with a finished run
    When one of its rows is clicked
    Then the results of that run open
    And no editor opens

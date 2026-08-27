Feature: The scenarios table
  As a person who owns a set of agent scenarios
  I want the scenarios of one test suite in one table
  So that I can author them and reach anything with a click

  Background: what a row shows.
    A row shows the name of the scenario and its labels as small pastel
    pills. A Run button and a row menu sit at the end of the row. There is no
    Edit button: clicking the row opens the editor, and Edit stays in the row
    menu, so the editor is reachable two ways. There is no leading file icon:
    it told scenarios apart from folders back when both shared one table, and
    no such table exists now.

    The row carries no author, no date and no version. The row carries no
    last result: the table is authoring only, and the last run of a case is
    reached from the row menu or on the Results tab.

    One test suite is always open, so the rows are always flat. There is no
    root list of suites: the rail already lists them.

    A summary line under the table says when the suite last ran and how it
    did.

  # --- Which suite is open ---

  @integration
  Scenario: The table lists the scenarios of the suite the address names
    Given two test suites holding cases
    When the address names the second suite
    Then only the scenarios of that suite are listed
    And no folder row is drawn

  @integration
  Scenario: An address that names no suite opens the first suite of the rail
    Given a project with two test suites
    When the Agent Testing page is opened with no suite in the address
    Then the first suite of the rail is open
    And its scenarios are listed

  @integration
  Scenario: An address naming a suite that does not exist opens the first suite
    Given a project with two test suites
    When the address names a suite that was archived
    Then the first suite of the rail is open
    And nothing reads as broken

  # --- Row content ---

  @integration
  Scenario: A row reads the title, the labels, Run and the row menu, in that order
    Given a scenario with the labels "critical" and "billing"
    When its row is read
    Then the title reads first
    And both labels are shown as pills beside the name
    And a Run button and a row menu end the row
    And no Edit button is offered on the row

  @integration
  Scenario: A row carries no leading file icon
    Given a scenario row
    When the leading edge of the row is read
    Then no file icon is drawn before the title

  @integration
  Scenario: The cases table shows the scenario column and the row actions, and no last result
    Given a scenario whose last run passed
    When the cases table is read
    Then the header carries only a Scenario column
    And no row carries a last result cell

  # --- Row actions ---

  @integration
  Scenario: Every row carries an outlined Run button with the word Run
    Given a scenario row
    When the end of the row is read
    Then an outlined button reading "Run" is shown
    And it carries the play icon

  @integration
  Scenario: The row menu offers Edit, Duplicate, Open last run, Move to suite..., History and Archive in order
    Given a scenario row with a finished run
    When its row menu is opened
    Then the actions read, in order: "Edit", "Duplicate", "Open last run", "Move to suite...", "History", "Archive"

  @integration
  Scenario: Move to suite... on a row starts checkbox selection with that row pre-checked
    Given a scenario row
    When "Move to suite..." is chosen from the row menu
    Then the cases table shows a checkbox on every row
    And the checkbox on that row is pre-checked
    And a selection action bar names the count and offers one "Move to suite" action

  @integration
  Scenario: Move to suite... confirms a bulk move to another suite
    Given a checkbox selection of one scenario
    When "Move to suite" is clicked in the selection action bar
    And a target test suite is picked from the dialog
    Then every selected scenario is moved to the target test suite
    And the selection clears

  @integration
  Scenario: The move dialog offers only real test suites
    Given a checkbox selection of one scenario
    When "Move to suite" is clicked in the selection action bar
    Then every test suite of the project is offered as a target
    And no "No test suite" option is offered, because a scenario always sits in one

  @integration
  Scenario: Open last run is not offered for a case that never ran
    Given a scenario with no run
    When its row menu is opened
    Then "Open last run" is not offered

  @integration
  Scenario: Duplicate creates a copy in the same suite
    Given a scenario in the suite "Refunds"
    When "Duplicate" is chosen
    Then a copy appears in the same suite
    And the copy carries the content of the original

  @integration
  Scenario: Archive asks for confirmation and names the case
    Given a scenario row
    When "Archive" is chosen
    Then a confirmation dialog names the case
    And confirming removes the row from the table

  # --- Row click ---

  @integration
  Scenario: Clicking a row opens the case editor
    Given a scenario whose last run finished
    When its row is clicked
    Then the case editor opens for that case
    And the run detail drawer does not open

  @integration
  Scenario: Clicking a row with no last run opens the case editor
    Given a scenario with no run in the period
    When its row is clicked
    Then the case editor opens for that case

  # --- The case editor ---

  @integration
  Scenario: New scenario opens the case dialog straight away
    Given the Agent Testing page is open
    When "New scenario" is chosen
    Then the case dialog opens titled "New scenario"
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
    Given a scenario at version 4
    When its editor is opened
    Then the dialog is titled "Edit scenario"
    And the header offers "v4 · History"
    And choosing it opens the version history

  @integration
  Scenario: Save and Run saves the case and then asks what to run it against
    Given the case dialog holds a title and one criterion
    When "Save & Run" is chosen
    Then the case is saved
    And the run dialog opens for the case that was saved

  # --- Customize scenario ---

  @integration
  Scenario: The parameters, the turn limits and the models wait behind chips
    Given the case dialog is open
    When the body is read
    Then the parameters, the simulator model, the judge and the turn limits are not shown
    And a "Customize scenario" section offers "Add parameters", "Define min and max turns" and "Override models"

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
    Given a scenario row with a last run
    When the Run button is clicked
    Then the run dialog opens
    And the run detail drawer does not open

  # --- Filtering ---

  @integration
  Scenario: The label filter narrows the table to one label
    Given cases with the labels "critical", "billing" and "edge"
    When "critical" is chosen in the label filter
    Then only the cases with that label are listed

  # --- The summary line ---

  @integration
  Scenario: A borderless line under the table says when the suite last ran
    Given a test suite with a finished run
    When that suite is opened
    Then a line under the table reads "Last run on" with the date of that run
    And the date sits directly left of the result of the whole suite
    And nothing else sits on the line between them

  # --- Empty states ---

  @integration
  Scenario: An open suite that holds no scenario says what to do
    Given a project with scenarios in another suite
    When an empty suite is opened
    Then a line offers to add a scenario or move one here

  @integration
  Scenario: A project with no scenario at all explains what a scenario is
    Given a test suite in a project with no scenario at all
    When the suite is opened
    Then an empty state explains what a scenario is
    And it offers to write the first one

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

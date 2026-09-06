Feature: The scenarios table
  As a person who owns a set of agent scenarios
  I want the scenarios of one test suite in one table
  So that I can author them and reach anything with a click

  Background: what a row shows.
    A row shows the name of the scenario and its labels as small pastel
    pills. A Run button and a row menu sit at the end of the row. There is no
    Edit button: clicking the row opens the editor, and Edit stays in the row
    menu, so the editor is reachable two ways. There is no leading file icon:
    it told scenarios apart from test suites back when both shared one table, and
    no such table exists now.

    The row carries no author, no date and no version. The row carries no
    last result: the table is authoring only, and the last run of a scenario is
    reached from the row menu or on the Results tab.

    One test suite is always open, so the rows are always flat. There is no
    root list of suites: the rail already lists them.

    The name of the open suite reads above the table, with the control that
    renames it. A test suite carries only a name, so renaming is the whole of
    editing one, and no "Edit suite" button is offered.

    The line above the table carries one button, "Open recent run", between
    "New scenario" and "Run suite". It drops a short list of the recent runs
    that covered a scenario of the open suite, and choosing one opens that run.
    A run belongs to the run plan it was started under, so a row names that
    plan rather than a number: a run of one scenario is a plan of its own, and
    the same suite is also covered by the plans that run all of it.

    The button is offered when, and only when, that list has rows. Both ask the
    one question: has a scenario of this suite run inside the period.

    A set that runs from code carries the same button and nothing else, because
    the platform cannot write it. Its results stay one click away: a row of the
    table opens them.

  # --- Which suite is open ---

  @integration
  Scenario: The table lists the scenarios of the suite the address names
    Given two test suites holding scenarios
    When the address names the second suite
    Then only the scenarios of that suite are listed
    And no test suite row is drawn

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
  Scenario: Labels are shown as small pastel pills beside the name
    Given a scenario with the labels "critical" and "billing"
    When its row is read
    Then each label is drawn as a small pill beside the name
    And each pill carries a colour of its own, so two labels never read alike
    And the pills stay quieter than the name of the scenario
    And a label reads in the monospace face, which tells it from the words
      of the row it sits beside

  @integration
  Scenario: The scenarios table shows the scenario column and the row actions, and no last result
    Given a scenario whose last run passed
    When the scenarios table is read
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
  Scenario: The row menu offers Edit, Duplicate, Open recent runs, Move to suite... and Archive in order
    Given a scenario row with a finished run
    When its row menu is opened
    Then the actions read, in order: "Edit", "Duplicate", "Open recent runs", "Move to suite...", "Archive"
    And no "History" action is offered, because the versions read inside the editor

  @integration
  Scenario: Open recent runs holds the runs of that scenario
    Given a scenario row with three finished runs
    When "Open recent runs" is opened from its row menu
    Then the runs of that scenario are listed newest first
    And each row reads the run plan the run belongs to, how long ago it started and how it did
    And choosing one opens it on the Results tab, under the plan that holds it

  @integration
  Scenario: The runs of a row are read only when its submenu is opened
    Given a scenario row with a finished run
    When its row menu is opened and the submenu is left closed
    Then the runs of that scenario are not read
    And opening the submenu reads them

  @integration
  Scenario: Every action of the row menu carries its icon
    Given a scenario row with a finished run
    When its row menu is opened
    Then every action carries its own icon before its words

  @integration
  Scenario: Move to suite... on a row starts checkbox selection with that row pre-checked
    Given a scenario row
    When "Move to suite..." is chosen from the row menu
    Then the scenarios table shows a checkbox on every row
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
  Scenario: Open recent runs is not offered for a scenario that never ran
    Given a scenario with no run
    When its row menu is opened
    Then "Open recent runs" is not offered

  @integration
  Scenario: Duplicate creates a copy in the same suite
    Given a scenario in the suite "Refunds"
    When "Duplicate" is chosen
    Then a copy appears in the same suite
    And the copy carries the content of the original

  @integration
  Scenario: Archive asks for confirmation and names the scenario
    Given a scenario row
    When "Archive" is chosen
    Then a confirmation dialog names the scenario
    And confirming removes the row from the table

  # --- Row click ---

  @integration
  Scenario: Clicking a row opens the scenario editor
    Given a scenario whose last run finished
    When its row is clicked
    Then the scenario editor opens for that scenario
    And the run detail drawer does not open

  @integration
  Scenario: Clicking a row with no last run opens the scenario editor
    Given a scenario with no run in the period
    When its row is clicked
    Then the scenario editor opens for that scenario

  # --- The scenario editor ---

  @unit
  Scenario: The scenario editor opens wider than a standard drawer
    Given the widths a drawer of the product can ask for by name
    When the scenario editor names the width it opens at
    Then that width is a step of the drawer recipe and not a width of its own
    And the step is wider than the standard medium drawer by about a fifth
    And it stays narrower than the large drawer, so four fields do not read as half a page

  @integration
  Scenario: New scenario opens the scenario dialog straight away
    Given the Agent Testing page is open
    When "New scenario" is chosen
    Then the scenario dialog opens titled "New scenario"
    And it asks for a title, a test suite, a situation and the criteria
    And no step asks to write the scenario with a model first

  @integration
  Scenario: The situation and the criteria grow with what is written in them
    Given the scenario dialog is open
    When more lines are written than the situation or the criteria field opens at
    Then the field grows to hold them, the way the prompt editor grows
    And it stops growing at three times the height it opened at
    And it scrolls from there, so the footer of the drawer stays on the screen
    And an empty field still opens at the height it always had

  @integration
  Scenario: The scenario dialog footer holds the labels, Save and Save and Run
    Given the scenario dialog is open
    When its footer is read
    Then the labels of the scenario sit on the left
    And "Save" and "Save & Run" sit on the right

  @integration
  Scenario: Editing a scenario names its version and opens the history
    Given a scenario at version 4
    When its editor is opened
    Then the dialog is titled "Edit scenario"
    And the header offers "v4 · History"
    And choosing it opens the version history

  @integration
  Scenario: The editor offers a recent run of the scenario it is open on
    Given a scenario with a finished run
    When its editor is opened
    Then the header offers "Open recent run" beside its version
    And the list holds the recent runs of that scenario alone
    And choosing one opens it on the Results tab and closes the editor

  @integration
  Scenario: The editor turns the recent runs off on a scenario that never ran
    Given a scenario with no run
    When its editor is opened
    Then "Open recent run" is offered but cannot be chosen
    And it says the scenario has not run yet

  @integration
  Scenario: Save and Run saves the scenario and then asks what to run it against
    Given the scenario dialog holds a title and one criterion
    When "Save & Run" is chosen
    Then the scenario is saved
    And the run dialog opens for the scenario that was saved

  # --- Customize scenario ---

  @integration
  Scenario: The parameters, the turn limits and the models wait behind chips
    Given the scenario dialog is open
    When the body is read
    Then the parameters, the simulator model, the judge and the turn limits are not shown
    And a "Customize scenario" section offers "Add parameters", "Define min and max turns" and "Override models"

  @integration
  Scenario: A chip opens its block and the block can be removed again
    Given the scenario dialog is open
    When "Define min and max turns" is chosen
    Then the min and the max turn fields are added to the form
    And the chip is no longer offered
    And removing the block takes the fields away and offers the chip again

  @integration
  Scenario: A block a chip opens reads under the criteria, not at the foot of the body
    Given the scenario dialog is open
    When "Define min and max turns" is chosen
    Then the block reads straight under the criteria
    And the "Customize scenario" chip row is the last thing in the body
    And a short scenario leaves no gap between the criteria and the block

  @integration
  Scenario: Two open blocks read in the order their chips sit in
    Given the scenario dialog is open
    When "Add parameters" and "Override models" are both chosen
    Then the parameters read above the model overrides, the way the chips are ordered

  @integration
  Scenario: Editing a scenario opens the blocks it already uses
    Given a stored scenario with parameters and a judge model of its own
    When its editor is opened
    Then the parameters block is open on the values of the scenario
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
    Given scenarios with the labels "critical", "billing" and "edge"
    When "critical" is chosen in the label filter
    Then only the scenarios with that label are listed

  # --- Renaming the open suite ---

  @integration
  Scenario: The name of the open suite carries a rename control
    Given the suite "Refunds" is open
    When the line above the table is read
    Then a rename control sits beside the name
    And choosing it opens the name dialog on "Refunds"

  @integration
  Scenario: The rename control is reachable from the keyboard
    Given the suite "Refunds" is open
    When the rename control is asked for keyboard focus
    Then it takes the focus
    And a person who uses no pointer can still rename the suite

  @integration
  Scenario: No Edit suite button sits above the table
    Given the suite "Refunds" is open
    When the line above the table is read
    Then no button reads "Edit suite"

  @integration
  Scenario: A person with read-only access is offered no rename control
    Given a person with read-only access to the project
    When the line above the table is read
    Then no rename control is offered

  # --- Recent runs ---

  @integration
  Scenario: One button above the table opens a recent run of the suite
    Given a test suite whose scenarios have a finished run
    When that suite is opened
    Then a button above the table reads "Open recent run"
    And it sits between "New scenario" and "Run suite"
    And no line under the table reads "Last run on"

  @integration
  Scenario: A run of one scenario of the suite is offered above the table
    Given a scenario of the open suite that ran on its own run plan
    And no run was started on a plan named after the suite
    When that suite is opened
    Then a button above the table reads "Open recent run"
    And the list holds that run under the name of the plan it ran on

  @integration
  Scenario: The list names the recent runs of that suite, newest first
    Given a test suite whose scenarios have three finished runs
    When "Open recent run" is opened
    Then the three runs are listed newest first
    And each row reads the run plan the run belongs to, how long ago it started and how it did

  @integration
  Scenario: A run that covered no scenario of the suite is left out
    Given a run of another suite inside the period
    When "Open recent run" is opened
    Then that run is not listed

  @integration
  Scenario: A run that belongs to no run plan is left out
    Given a run of a scenario of the suite in a set the platform keeps for itself
    When "Open recent run" is opened
    Then that run is not listed, because there is no plan to open it under
    And no internal name reads in the list

  @integration
  Scenario: A row of the list stays short
    Given the recent runs list is open on a run that passed
    When one row is read
    Then it holds the run plan, the time and the pass rate, and nothing else
    And the list stays a way into a run and not a second results table

  @integration
  Scenario: A run that is still going reads as running
    Given a test suite whose newest run has scenarios left to judge
    When "Open recent run" is opened
    Then that row reads "running" in place of a pass rate

  @integration
  Scenario: Choosing a run opens it on the Results tab
    Given the recent runs list is open on the suite "Refunds"
    When one of the runs is chosen
    Then the address names the Results tab, the plan the run belongs to and that run
    And the page is not reloaded, so a live run keeps streaming

  @unit
  Scenario: Every way into a recent run carries the same list icon
    Given the button above the table and the recent runs of a row menu
    When the icon of each is read
    Then both read the list icon the shared list names
    And no way into a run carries the history icon
    And the history icon is left to the version history, which is what it means

  @integration
  Scenario: A suite whose scenarios have no run in the period offers no recent runs button
    Given a test suite whose scenarios have no run in the period
    When that suite is opened
    Then no "Open recent run" button is shown

  @integration
  Scenario: The runs are read only when the list is opened
    Given a test suite with a finished run
    When that suite is opened and the list is left closed
    Then the runs of the suite are not read
    And opening the list reads them

  # --- Save & Run ---

  @integration
  Scenario: Save & Run opens the run dialog again after a run drawer was closed
    Given a scenario saved with Save & Run, whose run drawer was opened and closed
    When Save & Run is used a second time on the same page
    Then the run dialog opens again
    And the scenario is not only saved

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
  Scenario: An external set lists its scenarios read-only with a last run column
    Given an external set with runs for three named scenarios
    When the set is chosen in the rail
    Then the three scenario names are listed
    And each row shows when it last ran
    And no Run button and no row menu are offered

  @integration
  Scenario: Clicking a row of an external set opens its results
    Given an external set with a finished run
    When one of its rows is clicked
    Then the results of that run open
    And no editor opens

  @integration
  Scenario: A set that runs from code offers Open recent run and no View results
    Given an external set with a finished run
    When the line above its table is read
    Then it offers "Open recent run"
    And no button reads "View results"

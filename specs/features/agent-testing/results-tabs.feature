Feature: The Results tab
  As a person reading how a run went
  I want a list of run plans, then the runs of one plan, then the results of one run
  So that I can go from "what ran" to "what happened" in two clicks

  Background: three levels.
    The Results tab opens on a list titled "Test Runs". Each row is a run plan:
    a test suite, a custom run plan, or One-off runs, which is always last.

    Choosing a row opens that plan. The page title then reads the name of the
    plan. A sidebar on the left lists its runs, newest first, each with its
    number, its note, how long ago it started and its pass rate. The selected
    run has a grey background.

    The results of the selected run fill the rest of the page. They read as a
    table by default, and a toggle switches to the classic grid of live cards.

  # --- The Test Runs list ---

  @integration
  Scenario: The Test Runs list holds every run plan with One-off runs last
    Given a project with two test suites, one custom run plan and some one-off runs
    When the Results tab is opened
    Then the list is titled "Test Runs"
    And the two suites and the custom plan are listed
    And "One-off runs" is the last row

  @integration
  Scenario: New run plan sits in the header of the Test Runs list
    Given the Results tab is open on the list of run plans
    When the header of the list is read
    Then it offers "New run plan" beside the period picker
    And the button reads as a small outlined action, like "New test case"
    And choosing it opens the run plan editor

  @integration
  Scenario: A run plan row opens on a click and carries no chevron
    Given the Results tab is open on the list of run plans
    When a row is read
    Then it ends on its row menu
    And no chevron sits after the menu
    And clicking anywhere else on the row opens the plan

  @integration
  Scenario: A run plan row shows its last result
    Given a run plan whose last run passed three of three
    When the Test Runs list is read
    Then its row carries the pass summary of that last run

  @integration
  Scenario: Choosing a run plan opens its runs
    Given a run plan with three finished runs
    When its row is chosen
    Then the runs sidebar lists the three runs, newest first
    And the newest run is selected

  # --- The runs sidebar ---

  @integration
  Scenario: A sidebar entry shows the number, the note, the age and the pass rate
    Given a run started with the note "switched judge to the stricter rubric"
    When the runs sidebar is read
    Then the entry carries its run number
    And it shows the note
    And it shows how long ago it started
    And it shows its pass rate

  @integration
  Scenario: The selected run reads with a grey background and no coloured dot beside its name
    Given a run plan with three runs
    When one run is selected
    Then that entry has a grey background
    And no coloured circle sits beside the run name
    And the result circle under the name still reads the outcome

  @integration
  Scenario: Two runs never carry the same number
    Given a run plan whose newest run has just finished
    When the runs sidebar is read before the run count is read again
    Then the newest run carries a number of its own
    And no two runs in the sidebar read the same number

  @integration
  Scenario: The runs sidebar loads more runs on request
    Given a run plan with more runs than one page holds
    When the end of the runs sidebar is reached
    Then a control to load more is offered
    And using it adds the older runs below

  # --- The results ---

  @integration
  Scenario: The results read as a table by default
    Given a finished run of three cases against one target
    When the run is selected
    Then a table lists one row per case and target pair
    And each row shows the verdict, the duration and the cost

  @integration
  Scenario: A row that has not settled shows no time and no cost
    Given a run whose first case is still running
    When the results table is read
    Then the time and cost cell of that row is empty
    And the cell fills in once the case reaches its verdict

  @integration
  Scenario: The row menu of a result opens the editor of the test case
    Given a finished run of one case
    When the row menu of the result is opened
    Then it offers "Edit test case"
    And choosing it opens the editor of that test case

  @integration
  Scenario: The row menu of a result runs the test case again on its own
    Given a finished run of one case
    When the row menu of the result is opened
    Then it offers "Open the conversation"
    And it offers "Rerun this test case"

  @integration
  Scenario: A test suite is run from the header of its run plan
    Given a run plan that is a test suite
    When the top of the results is read
    Then a Run control is offered beside Edit
    And choosing it opens the run dialog on that suite

  @integration
  Scenario: A set that runs from code has no Run and no Edit
    Given a run plan that a code run writes into
    When the top of the results is read
    Then no Run control is offered
    And no Edit control is offered

  @integration
  Scenario: The classic grid can be switched on and stays on
    Given the results of a run are shown as a table
    When the grid toggle is chosen
    Then the classic cards of the current run are shown
    And the address holds the chosen view
    And opening another run keeps the grid view

  @integration
  Scenario: Only the selected run is shown, not every previous run
    Given a run plan with three finished runs
    When one run is selected
    Then only the results of that run are shown
    And the other runs stay in the sidebar

  @integration
  Scenario: The page title names the open run plan
    Given a run plan named "Checkout" is open
    When the page header is read
    Then the title reads "Checkout"
    And what the plan is reads small and muted beside it
    And the tabs stay in the middle of the header

  @integration
  Scenario: Leaving the run plan gives the page title back
    Given a run plan is open
    When the list of run plans is opened again
    Then the title reads "Agent Testing"

  @integration
  Scenario: The results header holds the run and the actions on one line
    Given a run plan is open
    When the top of the results is read
    Then the number of the selected run, how long ago it ran and its note read on the left
    And the pass summary, the view toggle and the actions of the plan read on the right
    And they are all on the same line
    And the back control stays in the sidebar

  @integration
  Scenario: The cards of the grid line up with the line above them
    Given the results of a run are shown as the grid of cards
    When the top of the grid is read
    Then the first card starts at the left edge of the summary line above it
    And the grid takes no padding of its own

  # --- Live runs ---

  @integration
  Scenario: A run that is still going updates without a reload
    Given a run that is queued and starting
    When its results are open
    Then each case moves from queued to running to its verdict as it happens
    And no manual reload is needed

  @integration
  Scenario: A run started from the rail appears in the sidebar without a page change
    Given a run plan is open
    When "Run suite" is chosen on another plan in the rail
    Then the address does not change
    And a placeholder entry for the new run appears in that other plan

  @integration
  Scenario: When the live connection drops the results still update
    Given a run is streaming into the page
    When the live connection is lost
    Then the results keep updating at the fallback cadence
    And nothing tells the person to reload

  # --- Stopping ---

  @integration
  Scenario: One case in a running batch can be stopped on its own
    Given a run in which one case is still running
    When Stop is chosen on that row
    Then that case stops
    And the other cases keep running

  @integration
  Scenario: A whole running batch can be stopped at once
    Given a run with several cases queued and running
    When Stop all is chosen for the run
    Then every queued and running case stops
    And cases that already finished keep their verdict

  @integration
  Scenario: Stop is not offered for a case that already finished
    Given a run in which every case finished
    When the results are read
    Then no Stop control is offered

  # --- Export ---

  @integration
  Scenario: The results of a run plan can be exported as CSV
    Given a run plan with finished runs
    When Export is chosen in the plan header
    Then the export dialog opens
    And confirming downloads the runs as a CSV file

  # --- The period ---

  @integration
  Scenario: The period widens on its own when the last run is older than the window
    Given a run plan whose last run is older than thirty days
    When the plan is opened
    Then the period widens until that run is inside it
    And the widened period reads in the picker

  @integration
  Scenario: A run plan with no run in the period says so
    Given a run plan with no run inside the selected period
    When the plan is opened
    Then an empty state says there is no run in this period
    And it offers to widen the period

  # --- Stalled runs ---

  @integration
  Scenario: A run that stopped reporting reads as stalled
    Given a run that stopped reporting long ago
    When the results are read
    Then that case reads as stalled with a warning mark
    And it is treated as finished for the counts

Feature: The Results tab
  As a person reading how a run went
  I want a list of run plans, then the runs of one plan, then the results of one run
  So that I can go from "what ran" to "what happened" in two clicks

  Background: three levels.
    The Results tab opens on a list titled "Test Runs". Each row is a run plan.
    A test suite is a group of scenarios and is never a row: the run plans
    that run it are. There is no bucket row that collects runs belonging to no
    plan either: a single scenario run gets a run plan of its own, so iterating
    on one scenario reads as run 1, run 2, run 3 against that agent.

    Choosing a row opens that plan. The page title then reads the name of the
    plan. A sidebar on the left lists its runs, newest first, each with its
    number, its note, how long ago it started and its pass rate. The selected
    run has a grey background.

    The results of the selected run fill the rest of the page. They read as a
    table by default, and a toggle switches to the classic grid of live cards.

  # --- The Test Runs list ---

  @integration
  Scenario: The Test Runs list holds one row for every run plan
    Given a project with one test suite and one run plan that runs that suite
    When the Results tab is opened
    Then the list is titled "Test Runs"
    And the run plan is listed and the test suite is not a row
    And the Scope cell of the plan names the test suite
    And no row collects the runs that belong to no plan

  @integration
  Scenario: New run plan sits in the header of the Test Runs list
    Given the Results tab is open on the list of run plans
    When the header of the list is read
    Then it offers "New run plan" beside the period picker
    And the button reads as a small outlined action, like "New scenario"
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
    Then its row carries the pass rate of that last run

  # --- The columns of the plan table ---

  @integration
  Scenario: The plan table holds seven columns in one order
    Given the Results tab is open on the list of run plans
    When the header of the table is read
    Then the columns read "Run plan", "Last run", "Scope", "Targets", "Pass" and "Trend"
    And the last column carries the row menu and no heading

  @integration
  Scenario: The Run plan column holds only the name
    Given a run plan named "Checkout"
    When its row is read
    Then the Run plan cell reads "Checkout"
    And no second line sits under the name

  @integration
  Scenario: The Last run column reads the age, the scenarios and the runs
    Given a run plan that ran today, holds three scenarios and ran twice in the period
    When its row is read
    Then the Last run cell reads "today · 3 scenarios · 2 runs"
    And it reads in muted text

  @integration
  Scenario: A run plan with no run in the period says so in the Last run column
    Given a run plan with no run inside the selected period
    When its row is read
    Then the Last run cell says there is nothing in the period

  @integration
  Scenario: The Scope column says what the plan covers
    Given a run plan whose scope names two test suites
    When its row is read
    Then the Scope cell names the two suites
    And a plan that covers every scenario reads "All scenarios"

  @integration
  Scenario: The Scope cell carries a mark for the kind of scope it is
    Given a run plan scoped to a test suite
    When its row is read
    Then a mark for a suite sits beside the scope words
    And a plan scoped to a label, to hand-picked scenarios, to every scenario
      or run from code each carries its own mark

  @integration
  Scenario: The Targets column names the agents the plan runs against
    Given a run plan that runs against "dev-agent" and "prod-agent"
    When its row is read
    Then the Targets cell names both agents

  @integration
  Scenario: A set that runs from code reads its last run and pass rate on the list
    Given a set that runs from code with runs inside the window
    When the list of run plans is read
    Then its row reads when it last ran, its pass rate and its trend
    And not "nothing in 30 days"

  @integration
  Scenario: The Pass column is a plain coloured percentage
    Given a run plan whose runs passed nine of ten
    When its row is read
    Then the Pass cell reads "90%"
    And it carries no box and no border
    And it carries no cost and no duration

  @integration
  Scenario: The Trend column draws one bar per run, oldest first
    Given a run plan with three runs that passed 100, 50 and 0 percent, oldest first
    When its row is read
    Then the Trend cell draws three bars
    And the first bar reads the oldest run
    And each bar takes its height and its colour from that run's pass rate

  @integration
  Scenario: The trend bars are softer than the text beside them
    Given a run plan with runs to draw
    When the Trend cell is read
    Then every bar is drawn at the same reduced opacity
    And that opacity is stated in one place for the whole page

  # --- The row menu of a run plan ---

  @integration
  Scenario: The row menu of a run plan offers to archive it
    Given the Results tab is open on the list of run plans
    When the row menu of a run plan is opened
    Then it offers "Archive run plan"
    And that action reads last, under "Edit run plan"
    And it reads in the colour of a destructive action

  @integration
  Scenario: Archiving a run plan asks first and then takes the row away
    Given the row menu of a run plan is open
    When "Archive run plan" is chosen
    Then a dialog names the plan and says its runs are kept
    And confirming archives that plan
    And the row leaves the list

  @integration
  Scenario: Leaving the archive dialog keeps the run plan
    Given the archive dialog of a run plan is open
    When the dialog is left without confirming
    Then nothing is archived
    And the row stays in the list

  @integration
  Scenario: A set that runs from code carries no archive action in its row menu
    Given a run plan that a code run writes into
    When its row menu is opened
    Then no archive action is offered
    And no "Edit run plan" action is offered

  @integration
  Scenario: Open last run is not offered for a plan with no run in the period
    Given a run plan with no run inside the selected period
    When its row menu is opened
    Then no "Open last run" action is offered
    And the plan can still be edited and archived

  @integration
  Scenario: Choosing a run plan opens its runs
    Given a run plan with three finished runs
    When its row is chosen
    Then the runs sidebar lists the three runs, newest first
    And the newest run is selected

  # --- The toolbar ---

  @integration
  Scenario: The toolbar puts the filters above the numbers they drive
    Given the Results tab is open on the list of run plans
    When the top of the tab is read
    Then the filter row reads first
    And the charts block reads under it
    And the table reads last

  @integration
  Scenario: The filter row holds four filters, the period and the Charts toggle
    Given the Results tab is open on the list of run plans
    When the filter row is read
    Then it offers a scenario filter, a label filter, a target filter and a status filter on the left
    And the period picker sits on the right
    And a "Charts" toggle sits beside the period picker
    And the toggle carries no caret

  @integration
  Scenario: Every control of the filter row is one height
    Given the Results tab is open on the list of run plans
    When the filter row is read
    Then the filter chips, the status select, the Charts toggle and the period picker share one height
    And they share one type size

  @integration
  Scenario: The charts block is hidden until the Charts toggle is used
    Given the Results tab is open on the list of run plans
    When the tab is first read
    Then no stat strip is shown
    And no pass rate over time chart is shown
    When "Charts" is chosen
    Then the stat strip and the pass rate over time chart are shown

  @integration
  Scenario: There is no Simple and Explorer switch
    Given the Results tab is open on the list of run plans
    When the toolbar is read
    Then no switch between a simple view and an explorer view is offered

  @integration
  Scenario: A filter cuts the list and every number with it
    Given the Results tab is open with the charts block shown
    When a scenario filter is chosen
    Then only the rows holding that scenario are listed
    And the stat strip reads the filtered rows
    And the pass rate over time chart reads the filtered rows

  # --- Group by ---

  @integration
  Scenario: Group by is an enclosed segmented control of four tabs
    Given the Results tab is open on the list of run plans
    When the Group by control is read
    Then it draws four connected tabs inside one enclosure
    And they read "Run plan", "Scenario", "Target" and "None"
    And it is not a dropdown
    And "Run plan" is chosen
    And each tab shows the pointer under the mouse

  @integration
  Scenario: Grouping by scenario opens a row for every run of that scenario
    Given two run plans that both hold the scenario "Refund a paid order"
    When "Scenario" is chosen in Group by
    Then one row reads "Refund a paid order"
    And opening it lists every run of that scenario across both plans
    And its Trend draws one bar per run

  @integration
  Scenario: A scenario that ran from code reads its name and folds its runs
    Given the runs of a set that runs from code, each carrying an id the SDK made up
    When "Scenario" is chosen in Group by
    Then one row reads the name the runs carried
    And opening it lists every run of that name

  @integration
  Scenario: The Scenario filter lists the scenarios that ran from code
    Given a scenario that ran from code inside the window
    When the Scenario filter is opened
    Then that scenario is offered under its name
    And choosing it narrows the list by its key

  @integration
  Scenario: A run from code reads default for its target and From code for its scope
    Given a set that runs from code
    When its row and its runs are read
    Then the scope reads "From code"
    And the target reads "default"
    And the Target grouping row for it reads "default" with the from code mark

  @integration
  Scenario: Choosing a run inside an opened row lands on its plan at that run
    Given a scenario row opened onto a run of the plan "Nightly"
    When that run is chosen
    Then the page lands on the plan "Nightly" open on that run
    And not on the newest run of the plan

  @integration
  Scenario: A target named by a run from code reads that name with the from code mark
    Given a run from code that reported the agent "AcmeSupportAgent"
    When "Target" is chosen in Group by
    Then the row for it reads "AcmeSupportAgent"
    And it carries the from code mark
    And it does not read the key its runs fold under

  @integration
  Scenario: The Targets column reads the agent name a run from code reported
    Given a set that runs from code whose runs reported the agent "AcmeSupportAgent"
    When its row is read on the list of run plans
    Then the Targets cell reads "AcmeSupportAgent"

  @integration
  Scenario: The Target filter lists the targets named by runs from code
    Given a target named by a run from code inside the window
    When the Target filter is opened
    Then that target is offered under the name the run reported
    And choosing it narrows the list by its key

  @integration
  Scenario: A run line reads the agent name its run reported
    Given a target row opened onto the runs behind it
    When a run line is read
    Then it names the agent the run reported

  @integration
  Scenario: A run of a set that runs from code opens the row the list draws for it
    Given a scenario row opened onto a run of a set that runs from code
    When that run is chosen
    Then the page lands on that set's row of the list, open on that run

  @integration
  Scenario: Grouping by target compares one agent against another
    Given runs against "dev-agent" and against "prod-agent"
    When "Target" is chosen in Group by
    Then one row reads "dev-agent" and one row reads "prod-agent"
    And each row reads the pass rate of that agent alone

  # The mark is the icon the agents page draws for the same agent, so a target
  # reads as the agent a person knows from that page. It carries a colour only
  # in a comparison, where the colour is what tells one target from another.

  @integration
  Scenario: A target row is marked with the kind of agent behind it
    Given runs against a connected agent and against an HTTP agent
    When "Target" is chosen in Group by
    Then each row is marked with the kind of its own agent
    And the marks carry no colour

  @integration
  Scenario: Grouping by none reads the flat list
    Given a filter has already narrowed the question
    When "None" is chosen in Group by
    Then one row is listed for every scenario, target and run

  # --- Colour ---

  @unit
  Scenario: A pass rate reads in the product's own status colours
    Given a pass rate
    When its colour is read
    Then green is the colour a passed run reads in everywhere a run is drawn
    And red is the colour a failed run reads in everywhere a run is drawn
    And amber is the orange of the theme

  @unit
  Scenario: One helper maps a pass rate to a colour for text and for bars
    Given a pass rate
    When its colour is read for the text and for the bar of the same row
    Then both read the same colour

  @unit
  Scenario: Green reads at one hundred percent only
    Given a run plan that passed 99 of 100
    When its pass rate colour is read
    Then it is not green
    And a run plan that passed every scenario is green

  @unit
  Scenario: Amber reads from forty percent and red reads under it
    Given a pass rate of 40 percent
    When its colour is read
    Then it is amber
    And a pass rate of 39 percent is red

  @unit
  Scenario: A pass rate that is not known reads grey
    Given a run plan whose runs reached no verdict
    When its pass rate colour is read
    Then it is grey

  @integration
  Scenario: The runs sidebar reads a pass rate on the same scale as the tables
    Given a run that passed 60 percent and a run that passed 90 percent
    When their entries in the runs sidebar are read
    Then both percentages read the same colour
    And the dot of an entry reads the colour of its percentage

  @unit
  Scenario: A run that is still going does not read as a failure
    Given a run that is still going
    When the colour of its status is read
    Then it is the colour of a queued run
    And it is not the colour of a failed run

  # --- The runs sidebar ---

  @integration
  Scenario: The runs sidebar holds only the back link and the run list
    Given a run plan is open
    When the runs sidebar is read
    Then it offers a "Results" back link
    And it lists the runs of the plan
    And the name of the plan is not repeated in the sidebar

  @integration
  Scenario: The run header reads the run, then the pass block, then the note
    Given a run of a plan that carries a note
    When the run header is read
    Then it reads "Run #3" first
    And the pass block reads after it
    And the note reads last

  # Evaluators on the run plan are not built yet. The two scenarios below state
  # how they must read once they are, and bind nothing until then.
  @unimplemented
  Scenario: The evaluator pills read after the pass block
    Given a run of a plan that carries evaluators
    When the run header is read
    Then the evaluator pills read after the pass block
    And they are drawn at the size of the pass block
    And the note still reads last

  @unimplemented
  Scenario: A score evaluator carries no threshold and no colour
    Given a run whose evaluators are one pass or fail check and one score
    When the evaluator pills are read
    Then the pass or fail pill is coloured by its verdict
    And the score pill reads its number with no colour
    And no threshold is shown for the score


  @integration
  Scenario: A sidebar entry shows the number, the note, the age and the pass rate
    Given a run started with the note "switched judge to the stricter criterion"
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
    Given a finished run of three scenarios against one target
    When the run is selected
    Then a table lists one row per scenario and target pair
    And each row shows the verdict, the duration and the cost

  @integration
  Scenario: A row that has not settled shows no time and no cost
    Given a run whose first scenario is still running
    When the results table is read
    Then the time and cost cell of that row is empty
    And the cell fills in once the scenario reaches its verdict

  @integration
  Scenario: The row menu of a result opens the editor of the scenario
    Given a finished run of one scenario
    When the row menu of the result is opened
    Then it offers "Edit scenario"
    And choosing it opens the editor of that scenario

  @integration
  Scenario: The row menu of a result runs the scenario again on its own
    Given a finished run of one scenario
    When the row menu of the result is opened
    Then it offers "Open the conversation"
    And it offers "Rerun this scenario"

  @integration
  Scenario: A run plan is run again from the header of its results
    Given a stored run plan
    When the top of the results is read
    Then a Run control is offered beside "Edit run plan"
    And choosing it opens the run dialog on that plan

  @integration
  Scenario: Edit run plan opens the run dialog on the configuration of the plan
    Given a stored run plan
    When the top of the results is read
    Then "Edit run plan" reads to the left of the Run control
    And choosing it opens the run dialog on that plan
    And the dialog holds the configuration the plan runs with

  @integration
  Scenario: A set that runs from code has no Run and no Edit run plan
    Given a run plan that a code run writes into
    When the top of the results is read
    Then no Run control is offered
    And no "Edit run plan" control is offered

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
    Then the number of the selected run, its pass summary and its note read on the left, in that order
    And a "Show run settings" toggle reads on the right, before the view toggle
    And the view toggle, "Edit run plan" and the Run control read after it, in that order
    And they are all on the same line
    And the back control stays in the sidebar

  @integration
  Scenario: A note never moves the actions of the header line
    Given a run that carries a note too long for the line
    When the header line is read
    Then the note takes the space the run summary leaves and is cut with an ellipsis
    And the full note is still reachable on the note itself
    And the actions keep their place at the right end of the line
    And the actions stay at the right end if the line has to break

  @integration
  Scenario: The run control of an open run offers to run it again
    Given a run of a plan is open
    When the header line is read
    Then the run control reads "Run again"

  @integration
  Scenario: The header line does not repeat when the run started
    Given a run of a plan is open
    When the header line is read
    Then how long ago the run started does not read on it
    And the runs sidebar still reads it
    And the run settings block reads it with its date when that block is shown

  @integration
  Scenario: The cards of the grid line up with the line above them
    Given the results of a run are shown as the grid of cards
    When the top of the grid is read
    Then the first card starts at the left edge of the summary line above it
    And the grid takes no padding of its own

  # --- The run settings ---

  @integration
  Scenario: The run settings stay hidden until they are asked for
    Given a run of a plan is open
    When the results are first read
    Then a "Show run settings" toggle is offered beside the view toggle
    And it reads as not pressed
    And no run settings block reads under the header
    And the results start directly under the header

  @integration
  Scenario: The toggle turns the run settings block on and off
    Given a run of a plan is open
    When "Show run settings" is chosen
    Then the run settings block reads under the header
    And the toggle reads as pressed
    When "Show run settings" is chosen again
    Then no run settings block reads under the header
    And the toggle reads as not pressed

  @integration
  Scenario: The run settings block says what the run was configured with
    Given a run started with the parameter "region" set to "eu-central", a repeat count of 3, the simulator model "openai/gpt-5-mini" and the judge model "openai/gpt-5"
    When "Show run settings" is chosen
    Then the block says when the run started
    And a block under the header reads the parameter and its value
    And the parameter reads in a monospace font
    And the block reads the repeat count
    And the block reads the simulator model
    And the block reads the judge model
    And each model reads with the icon of its provider

  @integration
  Scenario: Every label of the block sits beside its value
    Given the run settings block is shown on a run with both models recorded
    When the "Simulator model" and "Judge model" rows are read
    Then each label sits beside its value and not under it
    And a model row stands as tall as the "Started" row
    And the icon of the provider does not push the row open

  @integration
  Scenario: The first row of the block says when the run started and who started it
    Given a run started in the app by the person now reading it
    When "Show run settings" is chosen
    Then the first row of the block says when the run started
    And the same row says the run was started by them
    And no second row is added for the person

  @integration
  Scenario: A run started by a teammate reads that teammate's name
    Given a run started in the app by another member of the organization
    When "Show run settings" is chosen
    Then the row names that member
    And it does not read "You"

  @integration
  Scenario: A run whose person matches no member reads the time alone
    Given a run started in the app by a user id no member holds
    When "Show run settings" is chosen
    Then the first row of the block says when the run started
    And no person reads on that row
    And no name is made up from the recorded user id

  @integration
  Scenario: A run started with a key that names no person shows only the time
    Given a run whose metadata records no actor
    When "Show run settings" is chosen
    Then the first row of the block says when the run started
    And no person reads on that row
    And the row never reads "Unknown"

  @integration
  Scenario: A run started through the CLI names the CLI, not a person
    Given a run whose metadata records the surface "cli"
    When "Show run settings" is chosen
    Then the row says the run was started through the CLI
    And no name is made up from the recorded user id

  @integration
  Scenario: The block names the models the run really ran on
    Given a run that recorded the simulator model "openai/gpt-5-mini" and the judge model "openai/gpt-5" it resolved
    When "Show run settings" is chosen
    Then the block reads the simulator model the run resolved
    And the block reads the judge model the run resolved
    And neither row reads the project default
    And each model reads with the icon of its provider

  @integration
  Scenario: The judge always reads, and a run that named no model reads the project default
    Given a run stored before the resolved models were recorded, whose metadata names neither simulation model
    When "Show run settings" is chosen
    Then the judge reads as the project default model, because that is what such a run judged with
    And no simulator model reads in the block

  @integration
  Scenario: A run with no parameters and no repeat reads neither
    Given a run started with no parameters and a repeat count of one
    When "Show run settings" is chosen
    Then no parameters read in the block
    And no repeat count reads in the block

  @integration
  Scenario: The note stays in the header line and never moves into the block
    Given a run that carries a note
    When "Show run settings" is chosen
    Then the note still reads in the header line
    And the note does not read in the run settings block

  # --- Live runs ---

  @integration
  Scenario: A run that is still going updates without a reload
    Given a run that is queued and starting
    When its results are open
    Then each scenario moves from queued to running to its verdict as it happens
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
  Scenario: One scenario in a running batch can be stopped on its own
    Given a run in which one scenario is still running
    When Stop is chosen on that row
    Then that scenario stops
    And the other scenarios keep running

  @integration
  Scenario: A whole running batch can be stopped at once
    Given a run with several scenarios queued and running
    When Stop all is chosen for the run
    Then every queued and running scenario stops
    And scenarios that already finished keep their verdict

  @integration
  Scenario: Stop is not offered for a scenario that already finished
    Given a run in which every scenario finished
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

  # --- Loading and gating ---

  @integration
  Scenario: A plan opened on a hard reload never flashes a not-found state
    Given a URL that names a run plan the store has not read yet
    When the Results tab loads
    Then a skeleton reads while every plans query is still on its way
    And the plans list never reads for the frame before the plan record arrives

  @integration
  Scenario: The plans list shows on its own once every plans query settles
    Given a URL that names a plan and every plans query has answered empty
    When the Results tab loads
    Then the skeleton reads no more
    And the empty "no runs yet" state reads on the tab

  # --- Stalled runs ---

  @integration
  Scenario: A run that stopped reporting reads as stalled
    Given a run that stopped reporting long ago
    When the results are read
    Then that scenario reads as stalled with a warning mark
    And it is treated as finished for the counts

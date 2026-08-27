Feature: The run dialog
  As a person about to start a run
  I want one dialog that asks only what it must
  So that a repeat run is one click and a special run is still possible

  Background: one dialog, four entry points.
    The run dialog is the only place a run is configured. There is no separate
    run plan editor. It opens from a scenario row, from a test suite, from Run
    all, and from New run plan.

    The first three fix the scope, so the dialog says nothing about what runs.
    New run plan is the one entry point that asks, so it alone shows the "What
    runs" block with the four scope rules.

    The order is: "Run name", then "Agent to be tested", then "What runs" when
    the entry point asks for it, then the chip row.

    The chips are, in this order, "Add parameters", "Compare agents", "Add a
    note", "Run against a prompt", "Custom simulation models" and "Run multiple
    times". A chip adds one block to the form, and each added block can be
    removed again. The chips are drawn flat, with a dashed border and no shadow.

    A test suite is only a grouping and carries no run option. The run options
    of a run belong to the run plan its name resolves onto, so the next run
    dialog of that scope opens on the newest configuration for everybody on the
    team: the target, the second target of a comparison, the parameter
    overrides, the repeat count and the simulation models. A secret value is
    never written down: a secret row is written down by its key alone, so the
    next dialog shows the row and asks for the value again.

  # --- The run name ---

  @integration
  Scenario: The run name is the first field and holds the derived name
    Given a test suite named "Refunds" with the agent "dev-agent" used before
    When the run dialog is opened
    Then the first field reads "Run name"
    And it holds "Refunds dev-agent"
    And no text under it explains what the name does

  @integration
  Scenario: A stored run plan opens on the name it is stored under
    Given a stored run plan named "Refunds prod-agent"
    When the run dialog is opened on that plan
    Then the run name reads "Refunds prod-agent"
    And the agent is not added to the name a second time

    A plan is identified by its name, and the name of a plan already ends with
    the target it runs against. A name derived again would end with the target
    twice, the run would go out under a name no plan answers to, and that
    creates a second plan and forks the one the person opened.

  @unit
  Scenario: A folder answers to no plan name, so its run still derives one
    Given a suite of kind folder and a run plan of kind custom
    When each is opened in the run dialog from the Results tab
    Then the run plan opens on the name it is stored under
    And the folder opens on a name derived from its scope and its target

  @integration
  Scenario: The derived name follows the agent until the person types
    Given the run dialog open on the test suite "Refunds"
    When another agent is chosen
    Then the run name follows the new agent
    And typing a name of their own stops it following

  @integration
  Scenario: A comparison run derives both targets into the name
    Given the run dialog open on the test suite "Refunds" with "dev-agent" chosen
    When "Compare agents" is chosen and "prod-agent" is added
    Then the run name reads "Refunds dev-agent vs prod-agent"

  @integration
  Scenario: The name field lists the configurations this scope ran with before
    Given a test suite that ran with two different configurations before
    When the caret of the run name is chosen
    Then both configurations are listed, newest first
    And each says what it was run with

  @unit
  Scenario: Two configurations of one plan name are told apart by what differs
    Given two stored configurations that share the plan name and differ in repeat count
    When the list of previous configurations is read
    Then both are listed
    And each names the repeat count that tells it from the other

  @integration
  Scenario: The note text is never carried over
    Given a previous run of this scope that carried a note
    When its configuration is picked from the list
    Then the note field is empty
    And no note text is listed as part of the configuration

  @integration
  Scenario: A run plan that takes a note opens the note field ready
    Given a previous run of this scope that carried a note
    When its configuration is picked from the list
    Then the note block is open
    And the note field is empty
    And the note chip is no longer offered

  @integration
  Scenario: A stored run plan that took a note opens the note field ready
    Given a stored run plan whose last run carried a note
    When the run dialog is opened on that plan
    Then the note block is open
    And the note field is empty
    And "Add a note" is no longer offered

    The plan remembers that it takes a note. The words of the note belong to
    one run, and they never leave the run store.

  @integration
  Scenario: Picking a configuration refills the dialog and opens what it used
    Given a previous configuration with parameter overrides and a repeat count of 3
    When it is picked from the list
    Then the targets, the parameters and the repeat count are filled in
    And the parameter block and the repeat block are open
    And the run name stops following the agent

  @integration
  Scenario: Typing filters the list and opens it
    Given the run dialog with three previous configurations
    When part of one name is typed
    Then only the matching configurations are listed
    And a name that matches none of them leaves a plain field with no list

  @integration
  Scenario: The arrow keys move and Enter takes the highlighted entry
    Given the run name list is open with two entries
    When the down arrow is pressed twice and Enter is pressed
    Then the second entry is taken

  @integration
  Scenario: Escape closes the list and leaves the dialog open
    Given the run name list is open
    When Escape is pressed
    Then the list closes
    And the dialog is still open

  @integration
  Scenario: A scope with no history offers a plain field
    Given a test suite that never ran
    When the run dialog is opened
    Then the run name is a plain input
    And no caret is offered

  @integration
  Scenario: The run carries the name the dialog holds
    Given the run dialog with the run name "Nightly refunds"
    When the run is confirmed
    Then the run carries that name
    And it carries the scope, the targets and the repeat count with it
    And no run option is written onto the test suite

  # --- The agent section ---

  @integration
  Scenario: The dialog opens with the agent section and nothing else expanded
    Given a test suite with a target used before
    When the run dialog is opened
    Then the section reads "Agent to be tested"
    And the target used last time is selected
    And the customize chips are shown but add no fields yet

  @integration
  Scenario: The agent section offers a way to the agent setup page
    Given the run dialog is open on the agent section
    When the label line is read
    Then it offers "Configure" on the right
    And choosing it opens the agents page in another tab
    And the run dialog stays open

  @integration
  Scenario: The agents are shown as blocks with a local tunnel mark
    Given the project has two agents, one of them with a local tunnel
    When the run dialog is opened
    Then each agent is shown as a block with its name
    And the agent with a local tunnel carries a local tunnel mark
    And no file name and no environment name are shown

  @integration
  Scenario: A project with no target shows a Setup agent box
    Given a project with no agent and no prompt to test
    When the run dialog is opened
    Then a dotted box reading "Setup agent" is shown in place of the agent list
    And choosing it opens the instructions to set an agent up

  @integration
  Scenario: A run with no target selected is refused
    Given the run dialog is open with no target selected
    When Run is chosen
    Then the run is refused with "suite_targets_required"
    And the dialog stays open and says a target is needed
    And no run is scheduled

  # --- Chips ---

  @integration
  Scenario: The chips read in one fixed order
    Given the run dialog is open with a prompt published and parameters declared
    When the customize chips are read
    Then they read "Add parameters", "Compare agents", "Add a note", "Run against a prompt", "Custom simulation models" and "Run multiple times"

  @integration
  Scenario: The note chip adds a note field
    Given the run dialog is open
    When "Add a note" is chosen
    Then a note field is added to the form
    And the chip is no longer offered

  @integration
  Scenario: A field added by a chip can be removed again
    Given the run dialog with a note field added
    When the note field is removed
    Then the field is gone
    And "Add a note" is offered again
    And the run carries no note

  @integration
  Scenario: The parameters chip adds one input line for the values
    Given a test suite whose cases declare parameters
    When "Add parameters" is chosen
    Then one input line is added for the parameter values
    And the values declared on the cases are already filled in
    And a name written on that line is sent as the run parameter of that name

  @integration
  Scenario: The compare chip adds a second agent to the run
    Given the run dialog with one agent chosen
    When "Compare agents" is chosen
    Then a second agent can be added to the run
    And the run goes against both agents
    And removing the block leaves the first agent alone

  @integration
  Scenario: The simulation models chip adds the user simulator and the judge
    Given the run dialog is open
    When "Custom simulation models" is chosen
    Then the user simulator and the judge can be chosen
    And the run carries both

  @integration
  Scenario: The repeat chip adds the repeat count
    Given the run dialog is open
    When "Run multiple times" is chosen
    Then a repeat count can be given
    And the run repeats each scenario and target pair that many times

  # --- The parameter block ---

  @integration
  Scenario: The quiet controls of the dialog are drawn flat
    Given the run dialog in rows mode with one row
    When "Add parameter", the row remove control, the row lock and the block remove control are read
    Then none of them carries a shadow
    And only the actions at the foot of the dialog are lifted

  @integration
  Scenario: The parameter block offers a secret parameters toggle
    Given the run dialog with parameter overrides added
    When the top line of the block is read
    Then a "Secret parameters" toggle sits next to the remove control
    And the toggle is off, so the block holds one input line

  @integration
  Scenario: Turning the toggle on converts the line into key and value rows
    Given the run dialog with the parameter line "model=gpt-5, locale=de"
    When "Secret parameters" is turned on
    Then the block holds one row per pair, each with a key and a value
    And the row of "model" holds the value "gpt-5"
    And no value written on the line is lost

  @integration
  Scenario: Turning the toggle off writes the rows back onto the line
    Given the run dialog in rows mode with two plain rows
    When "Secret parameters" is turned off
    Then the block holds the single input line again
    And the line reads the rows back in the order they were shown

  @integration
  Scenario: A row can be added and a row can be taken away
    Given the run dialog in rows mode with one row
    When a row is added and a key and a value are typed into it
    Then the run carries both values
    And taking a row away drops its value from the run

  @integration
  Scenario: A row marked secret is masked and holds the block in rows mode
    Given the run dialog in rows mode with a plain row and a second row
    When the second row is marked secret
    Then its value field hides what is typed
    And the "Secret parameters" toggle can no longer be turned off
    And the toggle says a secret value cannot be written on one line

  @integration
  Scenario: A declared secret parameter is a locked row of the same list
    Given a test suite whose cases declare a secret parameter
    When "Add parameters" is chosen
    Then the block opens in rows mode, with no separate secret section
    And the declared secret is a row with its lock on and its key fixed
    And its value starts empty, hides what is typed, and is required
    And the plain parameters are rows of the same list
    And the run waits until the declared secret holds a value

  @integration
  Scenario: The prompt chip replaces the agent area
    Given the run dialog is open with an agent selected
    When "Run against a prompt" is chosen
    Then the prompt picker replaces the agent area
    And the prompts are listed the way the prompt list shows them, folders included

  @integration
  Scenario: Removing the prompt chip brings the agent area back
    Given the run dialog with the prompt picker shown
    When the prompt chip is removed
    Then the agent area comes back
    And the agent selected before is selected again

  # --- What runs ---

  @integration
  Scenario: An entry point that fixed the scope says nothing about it
    Given the run dialog opened from a test suite
    When the body of the dialog is read
    Then no "What runs" block is shown
    And no line says how many scenarios the scope holds
    And no line says what the run runs as

  @integration
  Scenario: New run plan opens the same dialog with the scope picker
    Given the Results tab with no plan open
    When "New run plan" is chosen
    Then the run dialog opens
    And the "What runs" block offers all four scopes
    And "All scenarios" is the one chosen
    And it says how many scenarios will run

  @integration
  Scenario: A run can be scoped to chosen test suites
    Given the run dialog opened from New run plan
    When "Selected test suites" is chosen
    Then the test suites of the project read as check boxes
    And the count follows the suites that are ticked

  @integration
  Scenario: A run can be scoped to chosen labels
    Given the run dialog opened from New run plan
    When "Selected labels" is chosen
    Then every label used by a scenario reads as a chip
    And the count follows the chips that are on

  @integration
  Scenario: A run can hold a hand-picked list of scenarios
    Given the run dialog opened from New run plan
    When "Specific scenarios" is chosen
    Then the scenarios read under the name of the test suite they are filed in
    And the count follows the cases that are ticked

  @integration
  Scenario: A run of one scenario is named after that scenario
    Given the run dialog opened from New run plan with an agent chosen
    When one scenario is hand-picked
    Then the run name reads that scenario name and the agent
    And it never reads a count in place of the name

  @integration
  Scenario: Running a stored run plan again keeps the scope it holds
    Given a stored run plan over a hand-picked list of scenarios
    When it is opened from the Results tab and run again
    Then the run covers the list the plan holds
    And the plan is not rewritten to cover the scenarios filed under its own id

  @integration
  Scenario: The derived name follows the scope while it is being picked
    Given the run dialog opened from New run plan with an agent chosen
    When "Selected test suites" is chosen and one suite is ticked
    Then the run name reads that suite name and the agent

  # --- Starting the run ---

  @integration
  Scenario: The dialog has Cancel and Run, with no dropdown on Run
    Given the run dialog is open
    When its footer is read
    Then it holds "Cancel" and "Run"
    And it offers no Save: running is what writes the plan down
    And Run is the only solid control
    And Run names how many scenarios it starts
    And Run carries no dropdown
    And the footer holds no other count

  @integration
  Scenario: Confirming a run remembers the target for next time
    Given a test suite with no target used before
    When a target is chosen and the run is confirmed
    And the run dialog for that suite is opened again
    Then that target is already selected

  @integration
  Scenario: A suite remembers the parameter overrides of its last run
    Given a test suite run with parameter overrides
    When the run dialog for that suite is opened again
    Then the parameter block is already open
    And it holds the values the last run used

  @integration
  Scenario: A suite remembers that it was run against a prompt
    Given a test suite run against a published prompt
    When the run dialog for that suite is opened again
    Then the dialog opens on the prompt picker
    And that prompt is already selected

  @integration
  Scenario: The run options are remembered for the whole team
    Given a test suite run with a target and parameter overrides by one person
    When another person opens the run dialog for that suite
    Then the same target and the same overrides are already selected

  @integration
  Scenario: The note of a run is never remembered
    Given a test suite run with the note "checking the stricter criterion"
    When the run dialog for that suite is opened again
    Then no note field is shown
    And "Add a note" is offered again

  @integration
  Scenario: A secret parameter value is never remembered
    Given a test suite whose cases declare a secret parameter
    And a run of that suite with the secret filled in
    When the run dialog for that suite is opened again
    Then the locked row is empty
    And the run waits until the secret holds a value again

  @integration
  Scenario: A secret row is remembered by its key alone
    Given a run of a suite with a plain row and a secret row filled in
    When the run dialog for that suite is opened again
    Then the block opens in rows mode
    And the plain row holds the key and the value of the last run
    And the secret row holds its key with an empty value the run waits for
    And no secret value was written onto the suite

  @integration
  Scenario: The dialog closes and the person stays where they were
    Given the run dialog is open from a scenario row
    When the run is confirmed
    Then the dialog closes
    And the view behind it does not change address

  # --- Failure paths ---

  @integration
  Scenario: A note over two hundred characters stops the run
    Given the run dialog with a note field added
    When more than two hundred characters are typed into the note
    Then the note field says it is too long
    And Run does not start a run

  @integration
  Scenario: A parameter value the cases do not declare is refused by name
    Given the run dialog with parameter overrides added
    When a value is given for a name none of the cases declare
    Then the run is refused with "scenario_parameter_unknown"
    And the rejection names the unknown name and the names the run does declare

  @integration
  Scenario: A run refused because every case is archived says so in the dialog
    Given a test suite in which every case is archived
    When the run is confirmed
    Then the dialog shows that there is nothing left to run
    And it does not show a generic unknown error

  @integration
  Scenario: A run with no name cannot start
    Given the run dialog with the run name cleared
    When the footer is read
    Then Run is off
    And it says the run needs a name

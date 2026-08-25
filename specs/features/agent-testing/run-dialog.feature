Feature: The run dialog
  As a person about to start a run
  I want a short dialog that asks only what it must
  So that a repeat run is one click and a special run is still possible

  Background: the shape of the dialog.
    The dialog opens with one section, "Agent to be tested". Under it sits a
    "Customize your run" section that offers chips. A chip adds one field to
    the form, and each added field can be removed again.

    The chips are "Add a note to your run", "Override parameters" and, last,
    "Run against a prompt". Choosing the prompt chip replaces the agent area
    with a prompt picker; removing it brings the agent area back. The chips are
    drawn flat, with a dashed border and no shadow.

    The run options of a test suite are written onto the suite itself, so the
    next run dialog of that suite opens on them for everybody on the team: the
    target, the parameter overrides, and a prompt in place of an agent. The
    note is the one field that never comes back.

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
  Scenario: The note chip adds a note field
    Given the run dialog is open
    When "Add a note to your run" is chosen
    Then a note field is added to the form
    And the chip is no longer offered

  @integration
  Scenario: A field added by a chip can be removed again
    Given the run dialog with a note field added
    When the note field is removed
    Then the field is gone
    And "Add a note to your run" is offered again
    And the run carries no note

  @integration
  Scenario: The override parameters chip adds one input line for the values
    Given a test suite whose cases declare parameters
    When "Override parameters" is chosen
    Then one input line is added for the parameter values
    And the values declared on the cases are already filled in
    And a name written on that line is sent as the run parameter of that name

  @integration
  Scenario: A secret parameter keeps a masked field of its own
    Given a test suite whose cases declare a secret parameter
    When "Override parameters" is chosen
    Then the secret is not on the input line, which would show what it holds
    And it has a masked field under the line
    And the run waits until the secret holds a value

  @integration
  Scenario: The prompt chip is the last chip of the row
    Given the run dialog is open with a prompt published
    When the customize chips are read
    Then "Run against a prompt" is the last chip

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

  # --- Starting the run ---

  @integration
  Scenario: The dialog has Cancel, Save and Run, with no dropdown on Run
    Given the run dialog is open
    When its footer is read
    Then it holds "Cancel", "Save" and "Run"
    And Run is the only solid control
    And Run names how many test cases it starts
    And Run carries no dropdown

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
    Given a test suite run with the note "checking the stricter rubric"
    When the run dialog for that suite is opened again
    Then no note field is shown
    And "Add a note to your run" is offered again

  @integration
  Scenario: A secret parameter value is never remembered
    Given a test suite whose cases declare a secret parameter
    And a run of that suite with the secret filled in
    When the run dialog for that suite is opened again
    Then the masked field is empty
    And the run waits until the secret holds a value again

  @integration
  Scenario: The dialog closes and the person stays where they were
    Given the run dialog is open from a test case row
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

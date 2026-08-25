Feature: The run plan editor
  As a person who assembles what a test run covers
  I want one dialog with a tab per group of questions
  So that the plan reads as three short forms rather than one long one

  Background: one dialog, three tabs.
    Agent Testing writes and edits a run plan in a dialog 580 pixels wide. A
    tab strip under the title holds General, Simulation models and Execution.

    A test suite is a run plan whose scope its own filing decides, so the
    dialog names it "Edit test suite" and states its case list instead of
    offering a picker.

  @integration
  Scenario: A new run plan opens on the General tab
    Given no run plan is being edited
    When the run plan editor is opened
    Then the dialog is titled "New run plan"
    And the General tab is the one on screen
    And the save control reads "Create run plan"

  @integration
  Scenario: An existing run plan reads its own title and save control
    Given a hand assembled run plan
    When it is opened in the editor
    Then the dialog is titled "Edit run plan"
    And the save control reads "Save"

  @integration
  Scenario: A test suite states its scope instead of offering a picker
    Given a run plan that is a test suite
    When the General tab is read
    Then it says the test cases come from that test suite
    And it says how many cases that is
    And no test case picker is offered

  @integration
  Scenario: The tabs hold the models and the execution options
    Given the run plan editor is open
    When the Simulation models tab is chosen
    Then the user simulator and the judge read there
    And the Execution tab holds the repeat count
    And no agent or prompt is picked in the editor

  @integration
  Scenario: A new run plan covers every test case
    Given no run plan is being edited
    When the run plan editor is opened
    Then the What runs block offers all four scopes
    And "All test cases" is the one chosen
    And it says how many test cases will run

  @integration
  Scenario: A plan can be scoped to chosen test suites
    Given the run plan editor is open
    When "Selected test suites" is chosen
    Then the test suites of the project read as check boxes
    And the count follows the suites that are ticked

  @integration
  Scenario: A plan can be scoped to chosen labels
    Given the run plan editor is open
    When "Selected labels" is chosen
    Then every label used by a test case reads as a chip
    And the count follows the chips that are on

  @integration
  Scenario: A plan can hold a hand-picked list of test cases
    Given the run plan editor is open
    When "Specific test cases" is chosen
    Then the test cases read under the name of the test suite they are filed in
    And the count follows the cases that are ticked

  @integration
  Scenario: Saving a run plan writes it and closes the dialog
    Given a run plan with a name, a test case and a target
    When Save is chosen
    Then the plan is written
    And the dialog closes

  @integration
  Scenario: A plan the server refuses keeps the dialog open
    Given a run plan whose name is already taken
    When Save is chosen
    Then the refusal reads under the name field
    And the dialog stays open

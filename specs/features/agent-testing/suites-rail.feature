Feature: The test suites rail
  As a person with many scenarios
  I want a rail on the left with my test suites and the sets that run from code
  So that I can move between them without losing my place

  Background: what the rail holds.
    The rail is glued to the left edge of the page. It holds the test suites
    of the project under a heading, then the external sets that run from code
    under a heading of their own. The period picker sits at the foot of the
    rail.

    Both headings are plain labels. Neither one is a control: there is no root
    list of suites to open, so a heading has nowhere to lead.

    Every project carries a Default test suite, created for it and holding
    every scenario that named no suite before. Default is an ordinary suite:
    it is listed first, and it can be renamed, archived and run like any
    other.

    An external set is read-only in the platform. It has no Run and no Edit,
    and choosing it opens its results.

    No row of the rail carries a count. How many scenarios a set holds reads
    beside the title of the panel, once, and not on every row.

  # --- What is listed ---

  @integration
  Scenario: The rail lists the test suites, then the external sets
    Given a project with two test suites and one external set
    When the Agent Testing page is opened
    Then the two test suites read first under a "Test Suites" heading
    And the external set follows them under a "From Code" heading
    And no entry carries a count

  @integration
  Scenario: The rail offers no root list of every scenario
    Given a project with two test suites
    When the rail is read
    Then no entry named "All scenarios" is offered
    And the test suites heading is a plain label and not a control

  @integration
  Scenario: The Default suite is listed first
    Given a project whose suites are Default, Checkout and Refunds
    When the rail is read
    Then "Default" is the first test suite listed

  @integration
  Scenario: The Default suite carries the actions of an ordinary suite
    Given the Default test suite in the rail
    When its row menu is opened
    Then "New scenario", "Run suite", "Rename" and "Archive suite" are offered
    And nothing marks it as unchangeable

  @integration
  Scenario: An external set carries the code icon and no counts
    Given a project with an external set
    When the rail is read
    Then the external set carries the test suite-with-code icon
    And it shows no count and no run time
    And it shows no Run control

  @integration
  Scenario: A project with no external sets hides the From Code heading
    Given a project with test suites and no external sets
    When the rail is read
    Then no "From Code" heading is shown

  @integration
  Scenario: The rail offers to create a test suite
    Given the Agent Testing page is open
    When the test suites heading is read
    Then a control to create a test suite is offered
    And using it adds the new suite to the rail
    And the new suite is opened

  # --- The row menu ---

  @integration
  Scenario: The row menu of a test suite offers its five actions in order
    Given a test suite in the rail
    When its row menu is opened
    Then the actions read, in order: "New scenario", "Run suite", "Rename", "Open recent runs", "Archive suite"

  @integration
  Scenario: Every action of the rail row menu carries its icon
    Given a test suite in the rail with a finished run
    When its row menu is opened
    Then every action carries its own icon before its words

  @unit
  Scenario: The rail menu and the scenario row menu read one list of icons
    Given the actions the two menus share
    When the icon of an action is read
    Then both menus read it from the same list
    And renaming a suite and editing a scenario carry the same pencil

  @integration
  Scenario: Open recent runs holds the runs that covered the suite
    Given a test suite with a finished run
    When "Open recent runs" is opened from its row menu
    Then the runs that covered a scenario of the suite are listed newest first
    And choosing one opens the Results tab on the run plan that holds it
    And that run is the one selected

  @integration
  Scenario: The submenu holds a run of a suite whose scenarios ran one at a time
    Given a suite whose scenarios only ran one at a time, each on its own run plan
    When "Open recent runs" is opened from its row menu
    Then each of those runs is listed, under the plan it ran on

  @integration
  Scenario: Open recent runs is not offered for a suite that never ran
    Given a test suite whose scenarios have no run inside the period
    When its row menu is opened
    Then "Open recent runs" is not offered

  @integration
  Scenario: Archive suite opens the confirmation dialog
    Given a test suite in the rail
    When "Archive suite" is chosen from its row menu
    Then the archive confirmation dialog opens naming the suite
    And confirming removes the suite from the rail

  @integration
  Scenario: Archiving the open suite opens the first suite that is left
    Given the open test suite is archived
    When the rail is read again
    Then the first remaining suite is open
    And no empty view is shown in between

  # --- Renaming a test suite ---

  @integration
  Scenario: Rename opens a small centered dialog holding only a Name field
    Given a test suite in the rail
    When "Rename" is chosen from its row menu
    Then a small centered dialog opens titled "Rename test suite"
    And the name of that suite is already in the field
    And the only field it holds is "Name"
    And it is sized to what it holds

  @integration
  Scenario: The name dialog carries no targets, no models, no repeat count and no evaluators
    Given the name dialog is open on a test suite
    When it is read
    Then no agent, no simulation model, no judge, no repeat count and no evaluator is offered
    And no tab strip is shown, because a suite is only a grouping

  @integration
  Scenario: The name dialog does not manage which scenarios are in the suite
    Given the name dialog is open on a test suite
    When it is read
    Then it lists no scenarios and offers no way to add or remove one
    And membership stays in the scenarios table, where "Move to suite..." changes it

  @integration
  Scenario: Saving the name dialog renames the suite
    Given the name dialog is open on the suite "Refunds"
    When the name is changed to "Refunds and returns" and saved
    Then the rail reads the new name
    And the dialog closes

  @integration
  Scenario: The name dialog refuses an empty name
    Given the name dialog is open on a test suite
    When the name is cleared and saved
    Then the dialog says a test suite needs a name
    And nothing is saved

  @integration
  Scenario: The name dialog offers no destructive action
    Given the name dialog is open on a test suite
    When its actions are read
    Then only "Cancel" and "Save" are offered
    And archiving stays in the row menu of the rail, where it already was

  @integration
  Scenario: A person with read-only access sees no changing actions in the row menu
    Given a person with read-only access to the project
    When a test suite row menu is opened
    Then "Open recent runs" is the only action offered
    And "New scenario", "Run suite", "Rename" and "Archive suite" are not offered

  # --- Selection ---

  @integration
  Scenario: Choosing a suite filters the scenario table to that suite
    Given a project with two test suites
    When one of them is chosen in the rail
    Then the scenario table lists only the scenarios of that suite
    And the suite is marked as selected in the rail

  @integration
  Scenario: Choosing an external set opens its results
    Given an external set in the rail
    When it is chosen
    Then its runs are shown
    And no Edit control is offered for it

  # --- Day zero ---

  @integration
  Scenario: A brand new project is asked to name its first test suite
    Given a new project with an agent connected and no test suite at all
    When the Agent Testing page is opened
    Then no suite is open and no empty suite view flashes first
    And the page asks for the name of the first test suite
    And no suite named "Default" is offered, because Default is only made for older projects

  @integration
  Scenario: A project with no agent is asked to connect one first
    Given a new project with no agent connected and no test suite
    When the Agent Testing page is opened
    Then the page offers to connect the agent to be tested
    And it does not ask for a test suite name yet

  @integration
  Scenario: Naming the first test suite opens it
    Given a new project being asked for its first test suite name
    When a name is given and confirmed
    Then the suite is created and opened
    And the rail lists it

  # --- The period picker ---

  @integration
  Scenario: The period picker sits at the foot of the rail and starts at thirty days
    Given the Agent Testing page is open
    When the foot of the rail is read
    Then a compact period picker is shown
    And it reads thirty days

  @integration
  Scenario: The period picker opens upward at the foot of the rail
    Given the Agent Testing page is open
    When the period picker is opened
    Then its list opens above the control
    And it stays inside the page

  @integration
  Scenario: Changing the period reloads the last results and the runs
    Given the period reads thirty days
    When seven days is chosen
    Then the last-result cells reload for the shorter period
    And the runs sidebar reloads for the shorter period
    And the address names the new period

  # --- The new-simulations announcement ---

  @integration
  Scenario: The rail carries the new-simulations announcement
    Given the Agent Testing page is open
    When the rail is read
    Then the announcement offering the way back to the previous screens is shown

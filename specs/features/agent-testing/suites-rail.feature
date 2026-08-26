Feature: The test suites rail
  As a person with many scenarios
  I want a rail on the left with my test suites and the sets that run from code
  So that I can move between them without losing my place

  Background: what the rail holds.
    The rail is glued to the left edge of the page. It holds All scenarios at
    the top, then the test suites of the project, then the external sets that
    run from code. The period picker sits at the foot of the rail.

    An external set is read-only in the platform. It has no Run and no Edit,
    and choosing it opens its results.

    No row of the rail carries a count. How many scenarios a set holds reads
    beside the title of the panel, once, and not on every row.

  # --- What is listed ---

  @integration
  Scenario: The rail lists All scenarios, then the test suites, then the external sets
    Given a project with two test suites and one external set
    When the Agent Testing page is opened
    Then "All scenarios" is the first entry
    And the two test suites follow it under a "Test Suites" heading
    And the external set follows them under a "From Code" heading
    And no entry carries a count

  @integration
  Scenario: An external set carries the code icon and no counts
    Given a project with an external set
    When the rail is read
    Then the external set carries the folder-with-code icon
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

  # --- The row menu ---

  @integration
  Scenario: The row menu of a test suite offers its five actions in order
    Given a test suite in the rail
    When its row menu is opened
    Then the actions read, in order: "New scenario", "Run suite", "Edit suite", "Open last run", "Archive suite"

  @integration
  Scenario: Open last run goes straight to the last run of that suite
    Given a test suite with a finished run
    When "Open last run" is chosen from its row menu
    Then the Results tab opens on that suite
    And the last run is selected in the runs sidebar

  @integration
  Scenario: Open last run is not offered for a suite that never ran
    Given a test suite with no run
    When its row menu is opened
    Then "Open last run" is not offered

  @integration
  Scenario: Archive suite opens the confirmation dialog
    Given a test suite in the rail
    When "Archive suite" is chosen from its row menu
    Then the archive confirmation dialog opens naming the suite
    And confirming removes the suite from the rail

  # --- Suite editor drawer ---

  @integration
  Scenario: Edit suite opens the suite editor drawer with four tabs
    Given a test suite in the rail
    When "Edit suite" is chosen from its row menu
    Then the suite editor drawer opens
    And it holds four tabs: "General", "Scenarios", "Simulation models", "Execution"

  @integration
  Scenario: The Scenarios tab lists the cases filed under the suite and offers add and remove controls
    Given the suite editor drawer is open on a test suite
    When the "Scenarios" tab is chosen
    Then every scenario filed under the suite is listed
    And every row carries a remove control
    And an "Add scenarios" control is offered

  @integration
  Scenario: Add scenarios opens a picker of cases not currently in the suite
    Given the suite editor drawer is open on a test suite
    And a scenario not filed under the suite exists
    When "Add scenarios" is chosen
    Then a dialog lists the scenarios not currently in the suite
    And selecting one and confirming files it under the suite

  @integration
  Scenario: A person with read-only access sees no changing actions in the row menu
    Given a person with read-only access to the project
    When a test suite row menu is opened
    Then "Open last run" is the only action offered
    And "New scenario", "Run suite", "Edit suite" and "Archive suite" are not offered

  # --- Selection ---

  @integration
  Scenario: Choosing a suite filters the case table to that suite
    Given a project with two test suites
    When one of them is chosen in the rail
    Then the case table lists only the cases of that suite
    And the suite is marked as selected in the rail

  @integration
  Scenario: Choosing an external set opens its results
    Given an external set in the rail
    When it is chosen
    Then its runs are shown
    And no Edit control is offered for it

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

  # --- The voice agents note ---

  @integration
  Scenario: The rail keeps the voice agents note
    Given the Agent Testing page is open
    When the rail is read
    Then the voice agents note is shown, as it is on the v1 page

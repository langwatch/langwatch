Feature: The test cases table
  As a person who owns a set of agent test cases
  I want one table with my cases grouped by suite and their last result
  So that I can see what passes and run anything from where I am

  Background: what a row shows.
    A row shows the name of the test case, its labels as small pastel pills,
    when it was added and by whom, and its last result. A Run button and a row
    menu sit at the end of the row.

    In All test cases the rows are grouped under their test suite name, with
    the unfiled cases last. Under a single suite the rows are flat.

    The whole table reads over the selected period. A summary line under the
    table says when the set last ran and how it did.

  # --- Grouping ---

  @integration
  Scenario: All test cases groups the rows under their test suite
    Given two test suites holding cases, and two unfiled cases
    When All test cases is opened
    Then each suite name heads a group of its own rows
    And the unfiled cases are in the last group

  @integration
  Scenario: A group heading carries the last result of the whole suite
    Given a test suite whose last run passed three of three cases
    When All test cases is opened
    Then the heading of that suite carries a pass summary reading three of three

  @integration
  Scenario: A single suite view lists its rows without group headings
    Given a test suite holding three cases
    When that suite is chosen in the rail
    Then the three rows are listed with no group heading

  # --- Row content ---

  @integration
  Scenario: Labels are shown as small pastel pills beside the name
    Given a test case with the labels "critical" and "billing"
    When its row is read
    Then both labels are shown as pills beside the name
    And the pills are quieter than the case name

  @integration
  Scenario: The added column reads as one line with the author and the date
    Given a test case added by "Lena Fischer" on 6 July
    When its row is read
    Then the added cell reads "Lena Fischer · Jul 6" on one line

  @integration
  Scenario: The last result cell shows the verdict of the last run
    Given a test case whose last run passed
    When its row is read
    Then the last result cell shows that it passed
    And hovering it shows the duration and the cost of that run

  @integration
  Scenario: A test case that never ran shows an empty last result
    Given a test case with no run in the period
    When its row is read
    Then the last result cell is empty
    And the row still offers Run

  @integration
  Scenario: Under a single suite the time and cost read beside the last result
    Given a test suite is chosen in the rail
    When a row with a finished run is read
    Then the duration and the cost read in the same cell as the last result

  @integration
  Scenario: The last result cells fill in after the table is drawn
    Given a project with many test cases
    When the case table is opened
    Then the rows are drawn at once
    And the last result cells fill in as the results arrive

  # --- Row actions ---

  @integration
  Scenario: Every row carries an outlined Run button with the word Run
    Given a test case row
    When the end of the row is read
    Then an outlined button reading "Run" is shown
    And it carries the play icon

  @integration
  Scenario: The row menu offers Edit, Duplicate, Open last run and Archive in order
    Given a test case row with a finished run
    When its row menu is opened
    Then the actions read, in order: "Edit", "Duplicate", "Open last run", "Archive"

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
  Scenario: Clicking a row with a last run opens that run
    Given a test case whose last run finished
    When its row is clicked
    Then the run detail drawer opens on that run

  @integration
  Scenario: Clicking a row with no last run opens the editor
    Given a test case with no run in the period
    When its row is clicked
    Then the case editor opens for that case

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
    And the group headings that hold none of them are hidden

  # --- The summary line ---

  @integration
  Scenario: A borderless line under the table says when the set last ran
    Given a test suite with a finished run
    When that suite is opened
    Then a line under the table reads when it last ran
    And the result of the whole set reads on the far right of that line

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

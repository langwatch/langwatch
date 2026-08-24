Feature: The Agent Testing page
  As a person who tests an agent
  I want one page with the test cases and the results side by side in tabs
  So that I do not move between several pages to do one job

  Background: the shape of the page.
    Agent Testing is one page behind a release flag. Its header holds the page
    title on the left, the tabs in the middle, and the actions on the right,
    all on one line. The content of the selected tab starts directly under that
    line.

    With the flag off, nothing changes. The main menu keeps the current
    Simulations group and the current pages work exactly as they do today.

  # --- The flag ---

  @integration
  Scenario: With the flag off the Agent Testing route is not reachable
    Given the Agent Testing release flag is off
    When the Agent Testing address is opened
    Then the page is not shown
    And the person is sent to a page they can read

  @integration
  Scenario: With the flag on the Agent Testing page opens
    Given the Agent Testing release flag is on
    When the Agent Testing address is opened
    Then the page is shown with its header and its tabs

  @integration
  Scenario: With the flag on the main menu shows one Agent Testing item
    Given the Agent Testing release flag is on
    When the main menu is read
    Then one item named "Agent Testing" is shown
    And the Simulations group is not shown

  @integration
  Scenario: With the flag off the main menu is unchanged
    Given the Agent Testing release flag is off
    When the main menu is read
    Then the current Simulations group is shown, unchanged
    And no Agent Testing item is shown

  @integration
  Scenario: A person without permission to read test cases cannot open the page
    Given the Agent Testing release flag is on
    And a person without permission to read test cases
    When the Agent Testing address is opened
    Then the page is refused
    And the flag alone does not grant access

  # --- The header ---

  @integration
  Scenario: The header holds the title, the tabs and the actions on one line
    Given the Agent Testing page is open
    When the header is read
    Then "Agent Testing" is on the far left
    And the tabs "Test cases" and "Results" are in the middle
    And the actions are on the far right
    And the header spans the full width of the page

  @integration
  Scenario: The header action changes with the selected tab
    Given the Agent Testing page is open on the Test cases tab
    Then the header offers "New test case"
    When the Results tab is chosen
    Then the header offers "New run plan"
    And it no longer offers "New test case"

  # --- Addresses ---

  @integration
  Scenario: The selected tab, suite and period are held in the address
    Given the Agent Testing page is open
    When a test suite is chosen in the rail and the period is changed
    Then the address names the tab, the suite and the period
    And opening that address again restores the same view

  @integration
  Scenario: Choosing a suite in the rail does not reload the page
    Given a run is streaming into the page
    When another test suite is chosen in the rail
    Then the address changes
    And the live connection is not dropped
    And the streaming run keeps updating

  @integration
  Scenario: Old simulations addresses keep working
    Given the Agent Testing release flag is on
    When a saved simulations address is opened
    Then the v1 page opens as it did before
    And no redirect to Agent Testing happens

  # --- Empty project ---

  @integration
  Scenario: A project with no test cases shows what to do first
    Given a project with no test cases and no runs
    When the Agent Testing page is opened
    Then an empty state explains what a test case is
    And it offers to create the first one

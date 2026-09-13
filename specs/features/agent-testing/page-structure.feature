Feature: The Agent Testing page
  As a person who tests an agent
  I want one page with the scenarios and the results side by side in tabs
  So that I do not move between several pages to do one job

  Background: the shape of the page.
    Agent Testing is one page behind a release flag. Its header holds the page
    title on the left and the tabs in the middle, on one line. The content of
    the selected tab starts directly under that line. With a run plan open the
    title reads the name of that plan instead.

    The header carries no action. Every action sits in the section header above
    the table it acts on, so the entry point is beside what it writes into.

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
  Scenario: A rule that names the organization lights up the main menu
    Given the Agent Testing release flag is off by default
    And the flag carries one targeting rule that names the organization of
        the person who reads the menu
    When the main menu is read
    Then one item named "Agent Testing" is shown
    And the Simulations group is not shown

  @integration
  Scenario: Quick Search offers Agent Testing while the flag is on
    Given the Agent Testing release flag is on
    When Quick Search is opened and "agent testing" is typed
    Then Quick Search offers the Agent Testing page
    And Quick Search offers neither Simulations nor Scenarios, because they
        lead to the same runs by another route

  @integration
  Scenario: Quick Search keeps the Simulations entries while the flag is off
    Given the Agent Testing release flag is off
    When Quick Search is opened and "simulations" is typed
    Then Quick Search offers Simulations
    And Quick Search offers no Agent Testing page

  @integration
  Scenario: A person without permission to read scenarios cannot open the page
    Given the Agent Testing release flag is on
    And a person without permission to read scenarios
    When the Agent Testing address is opened
    Then the page is refused
    And the flag alone does not grant access

  # --- The header ---

  @integration
  Scenario: The header holds the title and the tabs on one line
    Given the Agent Testing page is open
    When the header is read
    Then "Agent Testing" is on the far left
    And the tabs "Scenarios" and "Results" are in the middle
    And the header spans the full width of the page

  @integration
  Scenario: The title reads the run plan while one is open
    Given the Agent Testing page is open on a run plan named "Checkout"
    When the header is read
    Then "Checkout" is on the far left
    And what the plan is reads small and muted beside it
    And the tabs are still in the middle
    When the plan is left
    Then "Agent Testing" is on the far left again

  @integration
  Scenario: A long run plan name stays on one line
    Given the Agent Testing page is open on a run plan with a long name
    When the header is read
    Then the name is cut with an ellipsis rather than wrapped
    And the full name reads on hover
    And what the plan is still reads in full beside it

  @integration
  Scenario: Each tab name carries how many rows it holds
    Given the Agent Testing page is open
    When the header is read
    Then "Scenarios" carries the number of scenarios
    And "Results" carries the number of run plans

  @unit
  Scenario: The number beside the Results tab counts what the Test Runs list holds
    Given a project with one test suite, one run plan and one throwaway suite of the command line
    When the number beside "Results" is worked out
    Then only the run plan is counted
    And the Test Runs list holds the same rule, so the two can never disagree

  @integration
  Scenario: The selected tab is underlined on the header's own border
    Given the Agent Testing page is open
    Then the tabs run the full height of the header
    And the underline of the selected tab sits on the header's bottom border

  @integration
  Scenario: The header carries no action on either tab
    Given the Agent Testing page is open on the Scenarios tab
    Then the header offers no action
    When the Results tab is chosen
    Then the header still offers no action

  # --- The content column ---

  @integration
  Scenario: The content is held to a column and centred on the page
    Given the Agent Testing page is open on a wide window
    When the scenarios and the results are read one after the other
    Then the content of each is held to one readable column
    And the column is centred on the whole page, not on the space beside the rail
    And the column does not move when the tab changes

  @integration
  Scenario: A surface with no rail takes the width the rail would have used
    Given the Agent Testing page is open on the Results tab
    Then the list of run plans reserves no space for a rail
    And it is centred on the whole page
    And it is held to a wider column than a surface that has a rail beside it

  # --- Addresses ---

  @integration
  Scenario: The selected tab, suite and period are held in the address
    Given the Agent Testing page is open
    When a test suite is chosen in the rail and the period is changed
    Then the address names the tab, the suite and the period
    And opening that address again restores the same view

  @integration
  Scenario: An address naming a suite that does not exist degrades to the first one
    Given a project with test suites
    When an address naming a suite that was archived is opened
    Then the first suite of the rail is opened instead
    And the page does not render broken

  @integration
  Scenario: Choosing a suite in the rail does not reload the page
    Given a run is streaming into the page
    When another test suite is chosen in the rail
    Then the address changes
    And the live connection is not dropped
    And the streaming run keeps updating

  @integration
  Scenario: A saved simulations address opens in Agent Testing when the flag is on
    Given the Agent Testing release flag is on
    When a saved simulations address is opened
    Then the person is sent to the Agent Testing address that shows the same thing
    And the v1 page is not shown, not even for a frame

  @integration
  Scenario: A saved simulations address opens as it did when the flag is off
    Given the Agent Testing release flag is off
    When a saved simulations address is opened
    Then the v1 page opens as it did before

  @unit
  Scenario: Every simulations address has an Agent Testing address
    Given a simulations address for the run history, the scenario library, a run plan, a run set, a batch or one run
    When it is read as an Agent Testing address
    Then the same plan, set, batch or run is what opens
    And the period, the grouping, an open drawer and the tab key of a handoff travel with it

  @unit
  Scenario: The addresses the platform hands out name the interface the project reads
    Given the scenario library, the CLI, the MCP server and Langy ask the platform for the address of a run set, a batch, a run, a scenario or a run plan
    When the project reads Agent Testing
    Then the address is under /agent-testing
    And when the project reads the Simulations pages the address is under /simulations

  # --- Empty project ---

  @integration
  Scenario: A project with no scenarios shows what to do first
    Given a project with no scenarios and no runs
    When the Agent Testing page is opened
    Then an empty state explains what a scenario is
    And it offers to create the first one

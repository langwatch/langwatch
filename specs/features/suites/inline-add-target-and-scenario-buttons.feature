Feature: Inline Add Target and Add Scenario buttons
  As a LangWatch user
  I want Add Target and Add Scenario buttons inline with their search inputs
  So that I can quickly discover and use them without scrolling or navigating menus

  # The "+ agent" and "+ prompt" buttons at the bottom of the sidebar are hard
  # to discover. "Add Scenario" is buried in a menu. This feature moves both
  # actions inline with their respective search inputs for better discoverability.
  #
  # Important constraint: nested drawers must be managed via state (children),
  # not via navigation, to avoid nested drawer routing issues (#1962).

  Background:
    Given I am on a suite detail page with targets and scenarios configured

  @e2e
  Scenario: Adding a target via the inline button
    When I click the Add Target button next to the target search input
    Then the add-target drawer opens
    When I complete the target creation flow
    Then the new target appears in the target list

  @e2e
  Scenario: Adding a scenario via the inline button
    When I click the Add Scenario button next to the scenario search input
    Then the add-scenario drawer opens
    When I complete the scenario creation flow
    Then the new scenario appears in the scenario list

  @integration
  Scenario: Add Target button replaces bottom sidebar buttons
    When I view the suite sidebar
    Then I see an Add Target button inline with the target search input
    And the bottom sidebar does not contain separate agent and prompt buttons

  @integration
  Scenario: Add Target button uses an icon
    When I view the target search area
    Then the Add Target button displays a plus icon

  @integration
  Scenario: Add Scenario button is inline with the scenario search
    When I view the scenario search area
    Then I see an Add Scenario button inline with the scenario search input
    And the Add Scenario button displays a plus icon

  @integration
  Scenario: Add Target drawer opens as a child drawer, not via navigation
    When I click the Add Target button
    Then the drawer opens as a state-managed child component
    And the browser URL does not change to a drawer route

  @integration
  Scenario: Add Scenario drawer opens as a child drawer, not via navigation
    When I click the Add Scenario button
    Then the drawer opens as a state-managed child component
    And the browser URL does not change to a drawer route

  @integration
  Scenario: Add Target drawer reuses the existing target drawer component
    When I click the Add Target button
    Then the drawer that opens is the same component used in the evals area

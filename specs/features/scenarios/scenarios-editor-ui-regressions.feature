Feature: Scenarios editor UI regressions from Vite migration
  As a user running scenarios
  I want the per-row Cancel, the Add New Agent flow, and the Create Scenario drawer
  to behave correctly after the Vite + React Router migration (#3170)

  # Three bugs surfaced during manual QA of Scenarios after #3170:
  # - #3192: single-run Cancel button does nothing (no request fires)
  # - #3193: Add New Agent from Edit Scenario closes both drawers and navigates nowhere
  # - #3194: clicking "I'll write it myself" leaves two role=dialog drawer elements in the DOM

  Background:
    Given I am on the simulations runs page for my project

  # ---------------------------------------------------------------------------
  # #3192: per-row Cancel button on grid card must invoke the cancel mutation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Per-row Cancel button on a grid card fires the cancel mutation
    Given a batch run has an in-progress scenario run rendered in the grid view
    When I click the per-row Stop button on that grid card
    Then the cancel mutation is invoked with that scenario run's id
    And the card's row-open click handler does not fire

  @integration
  Scenario: Per-row Cancel control is not a nested HTML button inside the card
    Given a scenario grid card with a cancel button
    Then the card's outer clickable element renders as a <button> element
    But the cancel control inside it renders as a non-button element with role="button"

  # ---------------------------------------------------------------------------
  # #3193: Add New Agent flow from Edit Scenario must mount the chosen editor
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Clicking HTTP Agent in the type selector opens the HTTP editor drawer
    Given the Edit Scenario drawer is open with the Agent Type Selector visible
    When I click "HTTP Agent" in the type selector
    Then the HTTP editor drawer is mounted with its form visible
    And the URL reflects drawer.open=agentHttpEditor

  @integration
  Scenario: Clicking Code Agent in the type selector opens the code editor drawer
    Given the Edit Scenario drawer is open with the Agent Type Selector visible
    When I click "Code Agent" in the type selector
    Then the code editor drawer is mounted with its form visible
    And the URL reflects drawer.open=agentCodeEditor

  @integration
  Scenario: Clicking Workflow Agent in the type selector opens the workflow selector drawer
    Given the Edit Scenario drawer is open with the Agent Type Selector visible
    When I click "Workflow Agent" in the type selector
    Then the workflow selector drawer is mounted with its content visible
    And the URL reflects drawer.open=workflowSelector

  # ---------------------------------------------------------------------------
  # #3194: Create Scenario drawer must not coexist with its modal in the DOM
  # ---------------------------------------------------------------------------

  @integration
  Scenario: "I'll write it myself" leaves exactly one Create Scenario drawer in the DOM
    Given the New Scenario modal is open
    When I click "I'll write it myself"
    Then exactly one role="dialog" Create Scenario drawer is rendered

  @integration
  Scenario: ScenarioFormDrawerFromUrl is not rendered both explicitly and via the drawer registry
    Given the scenarios index page is mounted
    Then ScenarioFormDrawerFromUrl is mounted only once in the page tree
    And the drawer is sourced from CurrentDrawer via the drawer registry

Feature: Child drawers open as nested overlays instead of navigating
  As a LangWatch user
  I want drawers opened from within another drawer to appear as nested overlays
  So that I maintain context in the parent drawer and can return to it by closing the child

  # Implementation approach: Child drawers are rendered via local React state
  # within the parent drawer component, NOT via URL navigation.
  # This preserves parent state but sacrifices deep-linking to the child.
  #
  # Scope: SuiteFormDrawer child drawers only (scenarioEditor, agentHttpEditor).
  # ScenarioRunDetailDrawer already works correctly via local state.
  # Evaluations-v3 picker flows are out of scope (separate architecture).

  Background:
    Given I am logged into project "my-project"

  # ---------------------------------------------------------------------------
  # Case 1: Suite editor -> Create new scenario
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Creating a new scenario from suite editor opens as a child drawer
    Given the suite editor drawer is open
    When I click "Create New" in the scenario picker
    Then the scenario editor opens as a child drawer on top of the suite editor
    And the suite editor remains mounted underneath

  @integration
  Scenario: Closing the scenario editor child drawer returns to the suite editor
    Given the suite editor drawer is open
    And I opened the scenario editor as a child drawer
    When I close the scenario editor
    Then the suite editor drawer is visible with my previous form state intact

  @e2e
  Scenario: New scenario created in child drawer appears in suite editor's picker
    Given the suite editor drawer is open with 2 scenarios selected
    When I open the scenario editor as a child drawer
    And I create a new scenario named "Fresh Scenario"
    And I close the scenario editor
    Then the suite editor's scenario picker includes "Fresh Scenario"

  # ---------------------------------------------------------------------------
  # Case 2: Suite editor -> Create new agent (HTTP editor)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Creating a new agent from suite editor opens as a child drawer
    Given the suite editor drawer is open
    When I click "New Agent" in the target picker
    Then the agent HTTP editor opens as a child drawer on top of the suite editor
    And the suite editor remains mounted underneath

  @integration
  Scenario: Closing the agent editor child drawer returns to the suite editor
    Given the suite editor drawer is open
    And I opened the agent HTTP editor as a child drawer
    When I close the agent HTTP editor
    Then the suite editor drawer is visible with my previous form state intact

  # ---------------------------------------------------------------------------
  # Case 3: Scenario run detail -> View Trace (regression guard)
  # Already works via local state - these verify no regression.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Viewing a trace from scenario run detail opens as a child drawer
    Given the scenario run detail drawer is open for a completed run with a trace
    When I click "Open Thread"
    Then the trace details drawer opens as a child drawer
    And the scenario run detail drawer remains mounted underneath

  @integration
  Scenario: Closing the trace child drawer returns to the scenario run detail
    Given the scenario run detail drawer is open
    And I opened the trace details as a child drawer
    When I close the trace details drawer
    Then the scenario run detail drawer is visible with its original content

  # ---------------------------------------------------------------------------
  # Non-drawer contexts remain unaffected
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Opening a drawer from a page (non-drawer context) works normally
    Given I am on the suites list page with no drawer open
    When I click to open the suite editor
    Then the suite editor drawer opens as a root-level drawer
    And no parent drawer is underneath

  # ---------------------------------------------------------------------------
  # Parent state preservation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Suite editor form state survives a child drawer round-trip
    Given the suite editor drawer is open
    And I have entered "My Suite" as the suite name
    And I have selected 3 scenarios
    When I open the scenario editor as a child drawer
    And I close the scenario editor without saving
    Then the suite editor still shows "My Suite" as the suite name
    And 3 scenarios remain selected

  # ---------------------------------------------------------------------------
  # Keyboard interaction with stacked drawers
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Pressing Escape closes only the topmost child drawer
    Given the suite editor drawer is open
    And I opened the scenario editor as a child drawer
    When I press Escape
    Then the scenario editor closes
    And the suite editor remains open

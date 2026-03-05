Feature: Target selector Select All and Clear All
  As a LangWatch user editing a suite
  I want Select All and Clear All actions on the target picker
  So that I can quickly configure which targets to run without toggling each one

  # The ScenarioPicker already has a footer with "Select All" and "Clear" buttons.
  # The TargetPicker is missing these actions. Both pickers should offer the
  # same bulk-selection UX pattern.
  #
  # Decision: Do NOT extract shared selection logic. Targets use compound identity
  # (type, referenceId) while scenarios use simple string IDs. The data models
  # are structurally different, making a shared abstraction premature.
  #
  # Decision: "Select All" selects filtered targets only (matching ScenarioPicker).
  # "Clear" clears all targets regardless of filter (matching ScenarioPicker).

  Background:
    Given the suite form drawer is open
    And there are 5 available targets

  @integration
  Scenario: Target picker displays Select All and Clear buttons
    When I view the target picker
    Then I see a "Select All" button in the target picker footer
    And I see a "Clear" button in the target picker footer

  @integration
  Scenario: Clicking Select All selects all targets
    Given no targets are selected
    When I click "Select All" in the target picker
    Then all 5 targets are selected
    And the footer shows "5 of 5 selected"

  @integration
  Scenario: Clicking Clear deselects all targets
    Given all 5 targets are selected
    When I click "Clear" in the target picker
    Then no targets are selected
    And the footer shows "0 of 5 selected"

  @integration
  Scenario: Select All adds to partial selection
    Given 2 of 5 targets are selected
    When I click "Select All" in the target picker
    Then all 5 targets are selected

  @unit
  Scenario: selectAllTargets selects every available target
    Given available targets are "agent-1" and "prompt-1" and "agent-2"
    When selectAllTargets is called
    Then selectedTargets contains all 3 targets

  @unit
  Scenario: clearTargets removes all selected targets
    Given selectedTargets contains "agent-1" and "prompt-1"
    When clearTargets is called
    Then selectedTargets is empty

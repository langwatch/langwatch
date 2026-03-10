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

  @integration
  Scenario: Select All applies to visible filtered targets
    Given I filtered targets to "Agent"
    When I click "Select All" in the target picker
    Then all visible "Agent" targets are selected

  @integration
  Scenario: Clear removes every selected target regardless of filter
    Given some selected targets are not currently visible due to filtering
    When I click "Clear" in the target picker
    Then no targets are selected

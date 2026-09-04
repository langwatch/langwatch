Feature: Filing a scenario into a test suite
  As a person who writes agent scenarios
  I want to put each scenario in a test suite and move it later
  So that the scenario list stays organised as it grows

  Background: what a scenario shows.
    A scenario belongs to exactly one test suite. A scenario written without one
    named is filed into the project's Default suite, which is created on that
    first write if the project has none, so no scenario is ever loose. The editor
    therefore offers a choice that names no suite, and taking it files the scenario
    into Default rather than leaving it loose.

    The column stays nullable, because an archived scenario keeps whatever suite it
    had and a code-pushed scenario has no row at all. The rule is kept by the
    service on the write path. See specs/suites/default-suite.feature.

    The test suite side of this rule is in
    specs/suites/test-suite-membership-invariant.feature. This file covers what the
    person who owns the scenario sees and does.

  # --- Creating ---

  @integration
  Scenario: A scenario created from inside a suite is filed into that suite
    Given the test suite "Refunds" is selected in the rail
    When New scenario is chosen and the scenario is saved
    Then the scenario is filed in "Refunds"
    And it appears under the "Refunds" group in the scenario list

  @integration
  Scenario: A scenario created without naming a test suite is filed into Default
    Given a project whose scenarios are created without naming a test suite
    When New scenario is chosen and the scenario is saved
    Then the scenario is filed in the project's Default suite
    And the Default suite is created if the project had none

  @integration
  Scenario: The scenario editor offers the test suites of the project
    Given the project has the test suites "Refunds" and "Checkout"
    When the scenario editor is opened
    Then both suite names are offered
    And a choice that names no suite is offered

  # --- Moving ---

  @integration
  Scenario: Moving a scenario from its row menu regroups the scenario list
    Given a scenario filed in "Refunds"
    When the scenario is moved to "Checkout" from its row menu
    Then the row moves under the "Checkout" group
    And the "Refunds" group no longer lists it
    And no run history is lost

  @integration
  Scenario: Taking a scenario out of its suite moves it to Default
    Given a scenario filed in "Refunds"
    When the scenario is taken out of "Refunds"
    Then the row moves under the Default suite
    And "Refunds" no longer lists it

  @integration
  Scenario: Duplicating a scenario copies its suite
    Given a scenario filed in "Refunds"
    When the scenario is duplicated
    Then the copy is filed in "Refunds" too
    And the copy carries the situation, the criteria, the labels and the parameters of the original
    And the copy starts its own version history at version 1

  # --- Running one scenario on its own ---

  @integration
  Scenario: Running one scenario on its own starts a run plan of that scenario and target
    Given a scenario filed in "Refunds"
    When Run is chosen on its row and a target is confirmed
    Then the run starts under a run plan named after the scenario and that target
    And nothing is filed in the project's internal run set

  # --- Failure paths ---

  @integration
  Scenario: Filing a scenario into a suite of another project is refused with scenario_test_suite_not_found
    Given a test suite that belongs to another project
    When a scenario is filed into that suite
    Then the request is refused with "scenario_test_suite_not_found"
    And the scenario keeps the suite it had

  @integration
  Scenario: A person with read-only access cannot move a scenario
    Given a person with read-only access to the project
    When they try to move a scenario to another suite
    Then the request is refused with "insufficient_permissions"
    And the scenario is unchanged

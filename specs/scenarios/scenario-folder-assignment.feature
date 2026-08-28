Feature: Filing a test case into a test suite
  As a person who writes agent test cases
  I want to put each case in a test suite and move it later
  So that the case list stays organised as it grows

  Background: what a case shows.
    A test case belongs to exactly one test suite. A case written without one
    named is filed into the project's Default suite, which is created on that
    first write if the project has none, so no case is ever loose. The editor
    therefore offers a choice that names no suite, and taking it files the case
    into Default rather than leaving it loose.

    The column stays nullable, because an archived case keeps whatever suite it
    had and a code-pushed case has no row at all. The rule is kept by the
    service on the write path. See specs/suites/default-suite.feature.

    The folder side of this rule is in
    specs/suites/folder-membership-invariant.feature. This file covers what the
    person who owns the case sees and does.

  # --- Creating ---

  @integration
  Scenario: A case created from inside a suite is filed into that suite
    Given the test suite "Refunds" is selected in the rail
    When New test case is chosen and the case is saved
    Then the case is filed in "Refunds"
    And it appears under the "Refunds" group in the case list

  @integration
  Scenario: A case created without naming a test suite is filed into Default
    Given a project whose cases are created without naming a test suite
    When New test case is chosen and the case is saved
    Then the case is filed in the project's Default suite
    And the Default suite is created if the project had none

  @integration
  Scenario: The case editor offers the test suites of the project
    Given the project has the test suites "Refunds" and "Checkout"
    When the case editor is opened
    Then both suite names are offered
    And a choice that names no suite is offered

  # --- Moving ---

  @integration
  Scenario: Moving a case from its row menu regroups the case list
    Given a case filed in "Refunds"
    When the case is moved to "Checkout" from its row menu
    Then the row moves under the "Checkout" group
    And the "Refunds" group no longer lists it
    And no run history is lost

  @integration
  Scenario: Taking a case out of its suite moves it to Default
    Given a case filed in "Refunds"
    When the case is taken out of "Refunds"
    Then the row moves under the Default suite
    And "Refunds" no longer lists it

  @integration
  Scenario: Duplicating a case copies its suite
    Given a case filed in "Refunds"
    When the case is duplicated
    Then the copy is filed in "Refunds" too
    And the copy carries the situation, the criteria, the labels and the parameters of the original
    And the copy starts its own version history at version 1

  # --- Running one case on its own ---

  @integration
  Scenario: Running one case on its own starts a run plan of that case and target
    Given a case filed in "Refunds"
    When Run is chosen on its row and a target is confirmed
    Then the run starts under a run plan named after the case and that target
    And nothing is filed in the project's internal run set

  # --- Failure paths ---

  @integration
  Scenario: Filing a case into a suite of another project is refused with scenario_folder_not_found
    Given a test suite that belongs to another project
    When a case is filed into that suite
    Then the request is refused with "scenario_folder_not_found"
    And the case keeps the suite it had

  @integration
  Scenario: A person with read-only access cannot move a case
    Given a person with read-only access to the project
    When they try to move a case to another suite
    Then the request is refused with "insufficient_permissions"
    And the case is unchanged

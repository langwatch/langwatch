Feature: Filing a test case into a test suite
  As a person who writes agent test cases
  I want to put each case in a test suite and move it later
  So that the case list stays organised as it grows

  Background: what a case shows.
    A test case names at most one test suite. A case that names none is
    unfiled. The case list groups cases under their suite name and keeps the
    unfiled cases in a group of their own.

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
  Scenario: A case created from the All test cases view starts unfiled
    Given the All test cases view is open
    When New test case is chosen and the case is saved
    Then the case names no test suite
    And it appears in the unfiled group of the case list

  @integration
  Scenario: The case editor offers the test suites of the project
    Given the project has the test suites "Refunds" and "Checkout"
    When the case editor is opened
    Then both suite names are offered
    And an option to leave the case unfiled is offered

  # --- Moving ---

  @integration
  Scenario: Moving a case from its row menu regroups the case list
    Given a case filed in "Refunds"
    When the case is moved to "Checkout" from its row menu
    Then the row moves under the "Checkout" group
    And the "Refunds" group no longer lists it
    And no run history is lost

  @integration
  Scenario: Unfiling a case moves it to the unfiled group
    Given a case filed in "Refunds"
    When the case is unfiled
    Then the row moves to the loose cases at the root
    And the case is still listed in All test cases

  @integration
  Scenario: Duplicating a case copies its suite
    Given a case filed in "Refunds"
    When the case is duplicated
    Then the copy is filed in "Refunds" too
    And the copy carries the situation, the criteria, the labels and the parameters of the original
    And the copy starts its own version history at version 1

  # --- Display of an unfiled case ---

  @integration
  Scenario: All test cases lists the loose cases below the folder rows
    Given the project has two test suites and three cases with no test suite
    When the All test cases view is opened
    Then the suite folder rows come first
    And the three loose cases read as their own rows below

  @integration
  Scenario: An unfiled case runs on its own and lands in One-off runs
    Given an unfiled case
    When Run is chosen on its row and a target is confirmed
    Then the run starts
    And it is listed under One-off runs in the Test Runs list

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

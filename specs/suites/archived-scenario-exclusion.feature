Feature: Archived Dependency Exclusion from Suite Runs
  As a LangWatch user
  I want archived scenarios and targets to be automatically excluded from suite runs
  So that suites containing archived dependencies execute without errors

  Background:
    Given I am logged into project "my-project"
    And the following suite exists:
      | name           | scenarios                                          | targets                        |
      | My Test Suite  | Active Scenario, Another Active, Archived Scenario | Live Agent, Archived Agent     |
    And "Archived Scenario" has been archived
    And "Archived Agent" has been archived

  # ============================================================================
  # E2E: Happy Path — Suite runs skip archived dependencies
  # ============================================================================

  @e2e
  Scenario: Run a suite that contains archived scenarios and targets
    When I trigger a run for "My Test Suite"
    Then the run starts without errors
    And only "Active Scenario" and "Another Active" are executed
    And "Archived Scenario" is not executed
    And only "Live Agent" is used as a target

  # ============================================================================
  # Integration: Archived Scenario Filtering
  # ============================================================================

  @integration
  Scenario: Suite run excludes archived scenarios from job scheduling
    Given I am authenticated in project "test-project"
    And suite "Mixed Suite" references scenarios "Active A", "Active B", and "Archived C"
    And "Archived C" has been archived
    And the suite has 1 active target
    When the suite run is triggered
    Then jobs are scheduled only for "Active A" and "Active B"
    And no job is scheduled for "Archived C"

  @integration
  Scenario: Suite run fails when all scenarios are archived
    Given I am authenticated in project "test-project"
    And suite "All Archived Suite" references only archived scenarios
    When the suite run is triggered
    Then the run fails with an error indicating all scenarios are archived

  @integration
  Scenario: Deleted scenarios still cause validation errors
    Given I am authenticated in project "test-project"
    And suite "Broken Suite" references scenario "deleted-scenario" that no longer exists
    When the suite run is triggered
    Then the run fails with an error about invalid scenario references

  # ============================================================================
  # Integration: Archived Target Filtering
  # ============================================================================

  @integration
  Scenario: Suite run excludes archived targets from job scheduling
    Given I am authenticated in project "test-project"
    And suite "Target Suite" has 2 active scenarios
    And the suite references targets "Active Target" and "Archived Target"
    And "Archived Target" has been archived
    When the suite run is triggered
    Then jobs are scheduled only against "Active Target"
    And no job is scheduled against "Archived Target"

  @integration
  Scenario: Suite run fails when all targets are archived
    Given I am authenticated in project "test-project"
    And suite "No Targets Suite" references only archived targets
    And the suite has 1 active scenario
    When the suite run is triggered
    Then the run fails with an error indicating all targets are archived

  # ============================================================================
  # Integration: Warning Notice
  # ============================================================================

  @integration
  Scenario: Suite run reports skipped archived scenarios
    Given I am authenticated in project "test-project"
    And suite "Partial Suite" references scenarios "Active" and "Archived"
    And "Archived" has been archived
    When the suite run is triggered
    Then the run result includes a notice listing skipped archived scenarios

  @integration
  Scenario: Suite run reports skipped archived targets
    Given I am authenticated in project "test-project"
    And suite "Partial Target Suite" references targets "Active Target" and "Archived Target"
    And "Archived Target" has been archived
    When the suite run is triggered
    Then the run result includes a notice listing skipped archived targets

  # ============================================================================
  # Unit: Filtering Logic
  # ============================================================================

  @unit
  Scenario: Filters out archived scenarios from a reference list
    Given a suite with three scenarios where one is archived
    When the active scenarios are resolved
    Then only the two non-archived scenarios are returned

  @unit
  Scenario: Returns empty list when all scenarios are archived
    Given a suite with two scenarios that are both archived
    When the active scenarios are resolved
    Then an empty list is returned

  @unit
  Scenario: Returns all scenarios when none are archived
    Given a suite with two scenarios that are both active
    When the active scenarios are resolved
    Then both scenarios are returned

  @unit
  Scenario: Filters out archived targets from a reference list
    Given a suite with two targets where one is archived
    When the active targets are resolved
    Then only the non-archived target is returned

  @unit
  Scenario: Job count reflects only active scenarios and targets
    Given a suite with 3 scenarios, 2 targets, and repeat count 1
    And 1 scenario is archived and 1 target is archived
    When the suite run is triggered
    Then 2 jobs are scheduled for the 2 active scenarios and 1 active target

Feature: Every scenario belongs to a test suite
  As a person who writes test scenarios
  I want every scenario to sit in a suite
  So that no surface has to render or explain a loose scenario

  Background: the invariant, and where each half of it lives.
    A scenario belongs to exactly one suite. `Scenario.testSuiteId` stays a
    nullable column, because an archived scenario keeps the test suite it had
    for a later restore and a code-pushed scenario has no row at all. The
    invariant is enforced by the service on the write path, not by the column.

    Existing projects are brought to the invariant by one migration, which
    creates a `Default` test suite for each project that still holds an
    unfiled active scenario and files those scenarios into it. Default is an
    ordinary suite after that: it can be renamed, archived and run like any
    other.

    A brand new project starts with no suites at all. Default is a migration
    artifact, not an onboarding one, so nothing creates it until a scenario
    needs a home.

  # --- The migration ---

  @integration
  Scenario: The migration files every unfiled active scenario into a new Default suite
    Given a project holding two scenarios with no suite and one scenario already filed in "Refunds"
    When the Default suite migration runs
    Then the project holds a suite named "Default" of kind test suite
    And the two unfiled scenarios are filed in it
    And the scenario in "Refunds" is left where it was

  @integration
  Scenario: The migration leaves archived scenarios unfiled
    Given a project holding one archived scenario with no suite
    And no active scenario is unfiled
    When the Default suite migration runs
    Then the project has no suite named "Default"
    And the archived scenario still has no suite

  @integration
  Scenario: A project with no scenarios gets no Default suite
    Given a project that holds no scenario
    When the Default suite migration runs
    Then the project holds no suite

  @integration
  Scenario: The new Default suite reports the scenarios filed into it
    Given a project holding three unfiled active scenarios
    When the Default suite migration runs
    Then the Default suite lists those three scenarios as its members

  # --- Creating a scenario ---

  @integration
  Scenario: A scenario created with no suite is filed into Default
    Given a project that holds no suite
    When a scenario is created with no suite named
    Then a suite named "Default" of kind test suite is created
    And the scenario is filed in it

  @integration
  Scenario: A second scenario created with no suite reuses the same Default
    Given a project whose Default suite already holds one scenario
    When another scenario is created with no suite named
    Then no second Default suite is created
    And the Default suite holds both scenarios

  @integration
  Scenario: A scenario created with a suite named is filed there, not in Default
    Given a project holding a suite "Refunds"
    When a scenario is created naming "Refunds"
    Then the scenario is filed in "Refunds"
    And no Default suite is created

  @integration
  Scenario: A Default suite created while another suite already owns the slug takes a numbered slug
    Given a project holding a run plan whose slug is "default"
    When a scenario is created with no suite named
    Then a suite named "Default" of kind test suite is created
    And its slug is not "default"

  @integration
  Scenario: Two scenarios created at the same time share one Default suite
    Given a project that holds no suite
    When two scenarios are created with no suite named at the same time
    Then exactly one suite named "Default" exists
    And both scenarios are filed in it

  # --- Unfiling ---

  @integration
  Scenario: Removing a scenario from its suite files it into Default instead of leaving it loose
    Given a scenario filed in "Refunds"
    When the scenario is removed from "Refunds"
    Then the scenario is filed in the Default suite
    And "Refunds" no longer lists it

  # --- Membership stays correct ---

  @integration
  Scenario: Filing a scenario out of Default updates both suites
    Given a project whose Default suite holds two scenarios and a suite "Refunds" holds none
    When one scenario is moved to "Refunds"
    Then the Default suite lists one scenario
    And "Refunds" lists the moved scenario

Feature: Suite run validation uses repository classes
  As a developer
  I want suite run validation to use existing repository classes
  So that validation logic follows the Router -> Service -> Repository pattern
    and avoids duplicating queries already in ScenarioRepository and AgentRepository

  Background:
    Given a project belonging to an organization

  # ---------------------------------------------------------------------------
  # Scenario validation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Suite run succeeds when all scenarios exist
    Given a suite referencing existing scenarios
    When the suite run is triggered
    Then the run schedules jobs successfully

  @unit
  Scenario: Suite run fails when a scenario does not exist
    Given a suite referencing a nonexistent scenario
    When the suite run is triggered
    Then the run fails with an invalid scenario references error

  # ---------------------------------------------------------------------------
  # HTTP target validation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Suite run succeeds when HTTP target agent exists
    Given a suite with an HTTP target referencing an existing agent
    When the suite run is triggered
    Then the run schedules jobs successfully

  @unit
  Scenario: Suite run fails when HTTP target agent does not exist
    Given a suite with an HTTP target referencing a nonexistent agent
    When the suite run is triggered
    Then the run fails with an invalid target references error

  # ---------------------------------------------------------------------------
  # Prompt target validation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Suite run succeeds when prompt config exists in project
    Given a suite with a prompt target referencing an existing project-level config
    When the suite run is triggered
    Then the run schedules jobs successfully

  @unit
  Scenario: Suite run succeeds when prompt config is org-scoped
    Given a suite with a prompt target referencing an org-scoped config
    When the suite run is triggered
    Then the run schedules jobs successfully

  @unit
  Scenario: Suite run fails when prompt config is soft-deleted
    Given a suite with a prompt target referencing a soft-deleted config
    When the suite run is triggered
    Then the run fails with an invalid target references error

  @unit
  Scenario: Suite run fails when prompt config belongs to another organization
    Given a suite with a prompt target referencing a config from another organization
    When the suite run is triggered
    Then the run fails with an invalid target references error

  # ---------------------------------------------------------------------------
  # Unknown target type
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Suite run fails for targets with unknown type
    Given a suite with a target of unknown type
    When the suite run is triggered
    Then the run fails with an invalid target references error

  # ---------------------------------------------------------------------------
  # Organization resolution
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Organization ID is resolved from project for suite run
    Given a project with an associated organization
    When the suite run endpoint is called
    Then the organization ID is resolved and passed to the service

  @unit
  Scenario: Suite run fails when organization cannot be resolved
    Given a project with no associated organization
    When the suite run endpoint is called
    Then the endpoint returns an organization not found error

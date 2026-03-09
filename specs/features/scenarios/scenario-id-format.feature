Feature: Scenario ID format uses full prefix and KSUID
  As a developer
  I want scenario IDs to use the full "scenario" prefix and KSUID generation
  So that IDs are consistent with the project's KSUID naming conventions

  Background:
    Given a project exists

  @unit
  Scenario: New scenario ID uses "scenario_" prefix with KSUID
    When a scenario is created
    Then its ID starts with "scenario_"
    And the suffix is a valid KSUID

  @unit
  Scenario: SCENARIO resource is registered in KSUID_RESOURCES
    When I inspect the KSUID_RESOURCES constant
    Then it contains a SCENARIO entry with value "scenario"

  @unit
  Scenario: Scenario ID generation uses KSUID instead of nanoid
    When a scenario is created via the repository
    Then the ID is generated using the KSUID generate function
    And nanoid is not used for the scenario ID

  @integration
  Scenario: Existing scenarios with "scen_" prefix remain accessible
    Given a scenario exists with ID "scen_abc123"
    When I look up the scenario by its ID
    Then the scenario is found successfully

  @integration
  Scenario: Command bar entity registry recognizes both prefixes
    Given the entity registry maps prefixes to entity types
    When a scenario has the "scenario_" prefix
    Then it is recognized as a scenario entity
    And scenarios with the legacy "scen_" prefix are also recognized

  @unit
  Scenario: SCENARIO_RUN resource is registered in KSUID_RESOURCES
    When I inspect the KSUID_RESOURCES constant
    Then it contains a SCENARIO_RUN entry with value "scenariorun"

  @unit
  Scenario: Scenario failure handler uses KSUID for synthetic run IDs
    When a synthetic scenario run ID is generated
    Then it uses the "scenariorun_" prefix with KSUID generation
    And nanoid is not used for the run ID

  @unit
  Scenario: Dead generateBatchRunId in simulation-runner.service is removed
    Given generateBatchRunId exists in both simulation-runner.service and scenario.queue
    When the scenario.queue version already uses KSUID
    Then the simulation-runner.service duplicate is removed
    And all imports use the scenario.queue version

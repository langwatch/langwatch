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
  Scenario: Command bar entity registry recognizes both prefixes
    Given the entity registry maps prefixes to entity types
    When a scenario has the "scenario_" prefix
    Then it is recognized as a scenario entity
    And scenarios with the legacy "scen_" prefix are also recognized

  @unit
  Scenario: Synthetic scenario run ID uses "scenariorun_" prefix with KSUID
    When a synthetic scenario run ID is generated
    Then it starts with "scenariorun_"
    And the suffix is a valid KSUID

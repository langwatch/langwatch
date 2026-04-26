Feature: Scenario ID format uses full prefix and KSUID
  As a developer
  I want scenario IDs to use the full "scenario" prefix and KSUID generation
  So that IDs are consistent with the project's KSUID naming conventions

  Background:
    Given a project exists

  @unit @unimplemented
  Scenario: Synthetic scenario run ID uses "scenariorun_" prefix with KSUID
    When a synthetic scenario run ID is generated
    Then it starts with "scenariorun_"
    And the suffix is a valid KSUID

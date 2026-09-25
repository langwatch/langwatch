Feature: Scenario service boundary

  @unit
  Scenario: A required scenario read is tenant scoped
    Given a scenario exists in one project
    When another project requests that scenario through ScenarioService
    Then ScenarioNotFoundError is thrown

  @unit
  Scenario: Scenario archive delivery is retry safe
    Given a scenario was archived
    When the archive command is delivered again
    Then the original archive timestamp is retained

  @unit
  Scenario: Secret parameter definitions cannot persist a default
    Given a scenario parameter is secret
    When its definition includes a default value
    Then validation rejects the definition

  Scenario: Scenario input mapping is portable
    Given an agent input mapping is used by authoring and execution
    When either surface resolves it
    Then both use the scenario contract's mapping rules

  @unit
  Scenario: A scenario this project does not hold is refused as a named miss
    Given a scenario id no scenario in this project carries
    When the REST surface is asked to read it
    Then the response status is 404
    And it carries the code scenario_not_found, not an unknown error

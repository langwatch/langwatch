Feature: Scenario service boundary

  @unit
  Scenario: A required scenario read is tenant scoped
    Given a scenario exists in one project
    When another project requests that scenario through ScenarioService
    Then ScenarioNotFoundError is thrown

  @unit
  Scenario: Optional scenario discovery is explicit
    Given a scenario does not exist in the requested project
    When a caller uses tryGetById
    Then the result is null

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

Feature: Scenario service boundary

  Scenario: A required scenario read is tenant scoped
    Given a scenario exists in one project
    When another project requests that scenario through ScenarioService
    Then ScenarioNotFoundError is thrown

  Scenario: Optional scenario discovery is explicit
    Given a scenario does not exist in the requested project
    When a caller uses tryGetById
    Then the result is null

  Scenario: Scenario archive delivery is retry safe
    Given a scenario was archived
    When the archive command is delivered again
    Then the original archive timestamp is retained

  Scenario: Secret parameter definitions cannot persist a default
    Given a scenario parameter is secret
    When its definition includes a default value
    Then validation rejects the definition

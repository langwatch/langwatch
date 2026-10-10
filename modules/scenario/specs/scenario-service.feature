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

  @unit
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

  # The deployment's cipher is an input of the live scenario repository: it seals a
  # run's secret parameters where a run is resolved and opens them where the run's child
  # is prepared. The memory twin holds them in plaintext; nothing it stores outlives the process.
  @unit
  Scenario: A run secret sealed by an earlier release opens through the live scenario repository
    Given a run secret parameter an earlier release sealed with this deployment's key
    When the live scenario repository opens it for the run
    Then it is the secret in plaintext

  @unit
  Scenario: What the live scenario repository seals, an earlier release opens
    Given a run secret parameter the live scenario repository sealed
    When the deployment's cipher opens it as an earlier release did
    Then it is the secret unchanged
    And the sealed value is not the secret

Feature: Module secret registration
  The application preserves each module's declared secret handles while constructing its services.

  @unit
  Scenario: Declared module secrets survive application registration
    Given a module declares a session signing secret
    When the API or worker installs the module with a scoped secrets chain
    Then its constructed identity recognises the supplied key and rejects another key

  @unit
  Scenario: An available secret remains inaccessible without a module declaration
    Given the secrets chain contains a session signing secret
    And the module has not declared that handle
    When the worker constructs the module
    Then boot refuses with the secret_undeclared code

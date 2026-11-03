@agent
Feature: Scenario Connector agent
  A Scenario Connector is an agent type LangWatch hosts: the user writes only how to reach
  their own API, as a call block and optional setup and teardown blocks. Decided in ADR-194.

  @integration
  Scenario: A connector agent is created through the agent REST API
    Given a call block, a setup block, a teardown block, two secret names and a fixtures dataset
    When a connector agent is created through POST /api/v1/agents
    Then it answers 201 with type "connector" and the config as sent
    And a read of the agent answers the same config

  @unit
  Scenario: A connector agent needs a call block
    Given a connector config with no call block
    When it is parsed
    Then it is refused

  @unit
  Scenario: A connector block is Python and at most 64 KiB
    Given a connector block in another language, or with no code, or with code over 64 KiB
    When the config is parsed
    Then it is refused

  @unit
  Scenario: A connector names its secrets by their project secret names
    Given a connector config whose secret names include one that is not capital letters, digits and underscores
    When it is parsed
    Then it is refused

  @unit
  Scenario: A connector config keeps every field it is saved with
    Given a connector config with setup, call, teardown, secret names, a fixtures dataset and a timeout
    When it is parsed for the connector agent type
    Then every field is kept

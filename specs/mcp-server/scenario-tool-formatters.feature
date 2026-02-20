@unit
Feature: MCP Scenario Tool Formatters
  Scenario formatters produce AI-readable digest or raw JSON output

  Scenario: List scenarios digest includes expected fields per scenario
    Given a list of scenarios with names, situations, criteria, and labels
    When the formatter produces digest output
    Then each scenario includes id, name, situation preview, criteria count, and labels

  Scenario: List scenarios JSON format returns raw data
    Given a list of scenarios
    When the formatter produces JSON output
    Then the response is valid parseable JSON matching the scenario structure

  Scenario: Get scenario digest includes full details
    Given a single scenario with full details
    When the formatter produces digest output
    Then the response includes scenario name, situation, criteria items, and labels

  Scenario: Get scenario JSON format returns raw data
    Given a single scenario with full details
    When the formatter produces JSON output
    Then the response is valid parseable JSON matching the scenario structure

  Scenario: Discover scenario schema returns field metadata
    When the schema formatter produces scenario schema output
    Then the response includes field descriptions for name, situation, criteria, and labels
    And the response includes target types (prompt, http, code)
    And the response includes examples of good criteria

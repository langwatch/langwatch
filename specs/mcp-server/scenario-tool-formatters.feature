@unit
Feature: MCP Scenario Tool Formatters
  Scenario formatters produce AI-readable digest or raw JSON output

  # The list/get formatter behavior is bound via existing
  # `scenario-tools.unit.test.ts` (digest mode totals, situation
  # truncation, criteria count, labels, no-results path, JSON parse).
  # The remaining @unimplemented scenarios — sub-criteria with the
  # discover_scenario_schema endpoint — sit in
  # `discover-schema.unit.test.ts` and `discover-evaluator-schema.unit.test.ts`
  # which already have targeted unit tests but lack JSDoc bindings to
  # these specific scenario titles.

  @unimplemented
  Scenario: List scenarios digest includes expected fields per scenario
    Given a list of scenarios with names, situations, criteria, and labels
    When the formatter produces digest output
    Then each scenario includes id, name, situation preview, criteria count, and labels

  @unimplemented
  Scenario: List scenarios JSON format returns raw data
    Given a list of scenarios
    When the formatter produces JSON output
    Then the response is valid parseable JSON matching the scenario structure

  @unimplemented
  Scenario: Get scenario digest includes full details
    Given a single scenario with full details
    When the formatter produces digest output
    Then the response includes scenario name, situation, criteria items, and labels

  @unimplemented
  Scenario: Get scenario JSON format returns raw data
    Given a single scenario with full details
    When the formatter produces JSON output
    Then the response is valid parseable JSON matching the scenario structure

  @unimplemented
  Scenario: Discover scenario schema returns field metadata
    When the schema formatter produces scenario schema output
    Then the response includes field descriptions for name, situation, criteria, and labels
    And the response includes target types (prompt, http, code)
    And the response includes examples of good criteria

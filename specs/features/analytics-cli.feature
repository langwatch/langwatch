Feature: Analytics CLI Commands
  As a developer monitoring LLM application performance
  I want to query analytics via CLI commands
  So that I can check costs, latency, and usage without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: Query analytics with default metric
    When I run "langwatch analytics query"
    Then I see timeseries data for trace count over the last 7 days

  Scenario: Query analytics with a preset metric
    When I run "langwatch analytics query --metric total-cost"
    Then I see total cost data summed over the last 7 days

  Scenario: Query analytics with custom date range
    When I run "langwatch analytics query --metric avg-latency --start-date 2026-01-01 --end-date 2026-01-31"
    Then I see average latency data for the specified date range

  Scenario: Query analytics as JSON
    When I run "langwatch analytics query -f json"
    Then I see raw JSON with currentPeriod and previousPeriod arrays

  Scenario: List available metric presets
    When I run "langwatch analytics query"
    Then the output mentions available presets including trace-count, total-cost, avg-latency

  @unit
  Scenario: Query with the traces.count alias
    When I run "langwatch analytics query --metric traces.count"
    Then the query counts distinct traces, the way the trace-count preset does

  @unit
  Scenario: An unknown metric is refused with the known list
    When I run "langwatch analytics query --metric spans.count"
    Then no request is sent
    And I see an error naming the value, the presets and the metric paths the platform accepts

  # Langy's own turns are traces in the project too. The Trace Explorer, the
  # traces search API and the home overview leave them out unless asked, and
  # Langy answers analytics questions through this command, so it leaves them
  # out the same way. Otherwise "traces per model" counts Langy's own model.
  @unit
  Scenario: Langy's own turns are left out of the numbers
    When I run "langwatch analytics query --group-by metadata.model"
    Then the query leaves out traces whose origin is Langy

  @unit
  Scenario: Langy's own turns are counted when asked
    When I run "langwatch analytics query --include-langy"
    Then the query counts every trace, Langy's own turns included

  Scenario: Run analytics command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch analytics query"
    Then I see an error prompting me to configure my API key

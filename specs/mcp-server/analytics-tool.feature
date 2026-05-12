@integration
Feature: MCP Analytics Tool
  As a coding agent
  I want to query analytics metrics via the MCP server
  So that I can analyze production performance of AI agents

  # All scenarios in this file describe the get_analytics MCP tool. The
  # underlying analytics router is exercised in the LangWatch app
  # integration tests; the MCP-side wrapper has integration coverage
  # in `mcp-server/src/__tests__/all-tools.integration.test.ts` (the
  # `get_analytics` section already covers formatted output and API
  # parameter forwarding). What's missing is @scenario binding to the
  # specific feature scenarios below, plus assertions for groupBy and
  # currency formatting. Cheap to add when someone touches the
  # analytics tool wrapper.

  Background:
    Given the MCP server is configured with a valid API key
    And the LangWatch project has trace data

  @unimplemented
  Scenario: Agent queries trace count over time
    When the agent calls get_analytics with metric "metadata.trace_id" and aggregation "cardinality"
    Then the response contains timeseries data for the current period
    And each data point includes a date and a value
    And the response defaults to the last 7 days

  @unimplemented
  Scenario: Agent queries p95 completion time grouped by model
    When the agent calls get_analytics with:
      | metric      | performance.completion_time |
      | aggregation | p95                         |
      | groupBy     | model                       |
    Then the response contains timeseries data grouped by model name
    And values are formatted in human-readable units

  @unimplemented
  Scenario: Agent queries cost metrics for a date range
    When the agent calls get_analytics with:
      | metric    | performance.total_cost |
      | startDate | 2025-01-01             |
      | endDate   | 2025-01-31             |
    Then the response contains cost data for January 2025
    And values are formatted as currency

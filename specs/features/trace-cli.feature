Feature: Trace CLI Commands
  As a developer debugging LLM applications
  I want to search and inspect traces via CLI commands
  So that I can troubleshoot issues without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: Search traces with default date range
    Given my project has traces from the last 24 hours
    When I run "langwatch trace search"
    Then I see a table of recent traces with trace ID, input, output, and time

  Scenario: Search traces with a text query
    When I run "langwatch trace search -q 'hello world'"
    Then I see traces matching the query

  Scenario: Search traces with a custom date range
    When I run "langwatch trace search --start-date 2026-01-01 --end-date 2026-01-31"
    Then I see traces from the specified date range

  Scenario: Search traces with JSON output
    When I run "langwatch trace search -f json"
    Then I see raw JSON output with traces and pagination

  Scenario: Get trace details by ID
    Given my project has a trace with ID "trace_abc123"
    When I run "langwatch trace get trace_abc123"
    Then I see the full trace details in digest format

  Scenario: Get trace details as JSON
    Given my project has a trace with ID "trace_abc123"
    When I run "langwatch trace get trace_abc123 -f json"
    Then I see the full trace as raw JSON

  Scenario: Get trace that does not exist
    When I run "langwatch trace get nonexistent-id"
    Then I see an error that the trace was not found

  Scenario: Run trace command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch trace search"
    Then I see an error prompting me to configure my API key

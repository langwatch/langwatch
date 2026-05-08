@integration
Feature: MCP Trace Tools
  As a coding agent
  I want to search and inspect traces via the MCP server
  So that I can debug production issues in AI agents

  Background:
    Given the MCP server is configured with a valid API key
    And the LangWatch project has traces

  Scenario: Agent searches traces with a text query
    When the agent calls search_traces with query "login error"
    Then the response contains matching traces with summaries
    And each trace summary includes trace_id, input preview, timestamps, and status
    And the response defaults to the last 24 hours

  Scenario: Agent searches traces filtered by user_id
    When the agent calls search_traces with filters {"metadata.user_id": ["user-123"]}
    Then the response contains only traces from user "user-123"

  Scenario: Agent paginates through trace results
    Given there are more than 25 traces
    When the agent calls search_traces with pageSize 25
    Then the response includes a scrollId for pagination
    When the agent calls search_traces with the returned scrollId
    Then the response contains the next page of results

  Scenario: Agent gets a single trace by ID in AI-readable format
    Given a trace exists with id "trace-abc-123"
    When the agent calls get_trace with traceId "trace-abc-123"
    Then the response includes an ASCII tree of spans
    And the response includes span details with inputs and outputs
    And the response includes evaluation results
    And timestamps are formatted as relative time (e.g., "2 hours ago")

  Scenario: Agent gets a trace that does not exist
    When the agent calls get_trace with traceId "nonexistent-trace"
    Then the response contains an error message "Trace not found"

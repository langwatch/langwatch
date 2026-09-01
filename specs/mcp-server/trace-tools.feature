# See dev/docs/adr/132-a-trace-id-is-looked-up-never-searched.md for why a trace
# id is not reachable through search, and why the shape check below only ever
# adds advice instead of changing what the tool does.
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

  # Implementation:
  #   mcp/typescript/src/tools/search-traces.ts
  #   mcp/typescript/src/utils/format-evaluations.ts  (formatEvaluationLines)
  Scenario: Agent searches traces and sees evaluation results without a follow-up call
    Given a trace exists with an evaluation result
    When the agent calls search_traces with a query matching that trace
    Then the trace summary includes evaluation pass/fail status, score, and label
    And the agent does not need to call get_trace to see the evaluation results

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

  # Implementation:
  #   mcp/typescript/src/tools/search-traces.ts
  #
  # An empty result is the one moment the caller needs a redirect, and it was
  # the one place the tip naming get_trace never printed. These four scenarios
  # are @unimplemented until the bindings land alongside the change; the tag
  # comes off in the same commit as the tests.

  @unimplemented
  Scenario: Agent pastes a trace id into the search query
    Given a trace exists with id "trace_4bf92f3577b34da6a3ce929d0e0e4736"
    When the agent calls search_traces with query "trace_4bf92f3577b34da6a3ce929d0e0e4736"
    Then the response reports that no traces matched
    And the response says the query looks like a trace id and names get_trace

  @unimplemented
  Scenario: A search that matches nothing says which window it searched
    When the agent calls search_traces with a query that matches no trace
    Then the response reports that no traces matched
    And the response states the time window it searched
    And the response names get_trace for looking up a known trace id

  # The shape check recognises the OTel and trace_-prefixed forms only. A
  # customer-assigned id is unrecognisable by construction — TraceId is a
  # free-form String — so the unconditional guidance is what has to carry it.
  @unimplemented
  Scenario: A trace id in a format the shape check cannot recognise still gets guidance
    Given the project's traces carry customer-assigned ids like "order-12345"
    When the agent calls search_traces with query "order-12345"
    Then the response reports that no traces matched
    And the response names get_trace for looking up a known trace id

  # The load-bearing guarantee of ADR-132: advice only, never routing.
  @unimplemented
  Scenario: An id-shaped query is still executed as a search
    When the agent calls search_traces with query "trace_4bf92f3577b34da6a3ce929d0e0e4736"
    Then the server receives a trace search request
    And the server receives no single-trace lookup

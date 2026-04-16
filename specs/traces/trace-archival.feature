Feature: Trace archival
  Users can archive traces to hide them from query results without
  permanently deleting the underlying data.

  Background:
    Given a project with traces stored in ClickHouse

  Scenario: Archive a single trace via REST API
    When the user sends POST /api/traces/:traceId/archive
    Then the trace is marked as archived in ClickHouse
    And subsequent trace list queries exclude that trace
    And the response status is 200

  Scenario: Archive multiple traces via REST API
    When the user sends POST /api/traces/archive with a list of trace IDs
    Then all specified traces are marked as archived
    And subsequent trace list queries exclude those traces

  Scenario: Archived traces are excluded from search results
    Given a trace has been archived
    When the user searches traces for the project
    Then the archived trace does not appear in results
    And the total hit count does not include the archived trace

  Scenario: Archived traces are excluded from thread queries
    Given a trace in a thread has been archived
    When the user fetches traces by thread ID
    Then the archived trace does not appear in the thread

  Scenario: Archived traces are excluded from topic counts
    Given a trace with a topic assignment has been archived
    When the user fetches topic counts
    Then the archived trace is not counted

  Scenario: Archive trace via tRPC
    When the user calls the traces.archive mutation with a trace ID
    Then the trace is archived
    And it no longer appears in traces.getAllForProject results

  Scenario: Archive trace via MCP tool
    When the user invokes the archive_traces MCP tool with a trace ID
    Then the API archives the trace
    And subsequent get_trace calls return a 404 for that trace

  Scenario: Archival is recorded as an event
    When a trace is archived
    Then a lw.obs.trace.trace_archived event is emitted
    And the event contains the trace ID and archival timestamp

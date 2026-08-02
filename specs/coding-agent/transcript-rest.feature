@coding-agent @api
Feature: Coding agent transcript over REST and CLI
  As a CLI, MCP server, or export pipeline reading coding agent sessions
  I want the derived transcript of a trace over the REST API
  So that reading a session does not require running the web app

  # The transcript derivation already exists and powers the terminal view in
  # the trace drawer. This feature only opens a REST door to the same
  # derivation for API key callers, plus a CLI command through that door.

  @integration
  Scenario: transcript endpoint returns the derived transcript for a coding-agent trace
    Given a stored coding-agent trace with log records
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the response carries the transcript entries the terminal view derives

  @integration
  Scenario: transcript endpoint answers empty for a trace without coding-agent content
    Given a stored trace that is not coding-agent origin
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the response carries an empty transcript list rather than an error

  @integration
  Scenario: transcript endpoint rejects an unknown trace
    When GET /api/traces/{traceId}/transcript is called for a trace id that does not exist
    Then the request fails with a not found error

  @unit
  Scenario: the CLI prints a trace transcript
    Given the transcript endpoint returns entries for a trace
    When I run "langwatch trace transcript that-trace-id"
    Then the transcript entries are printed to stdout
    And machine output mode prints the raw JSON document

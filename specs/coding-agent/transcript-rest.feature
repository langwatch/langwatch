@coding-agent @api
Feature: Coding agent transcript over REST and CLI
  As a CLI, MCP server, or export pipeline reading coding agent sessions
  I want the derived transcript of a trace over the REST API
  So that reading a session does not require running the web app

  # The transcript derivation already exists and powers the terminal view in
  # the trace drawer. This feature only opens a REST door to the same
  # derivation for API key callers, plus a CLI command through that door.

  @unit
  Scenario: transcript endpoint returns the derived transcript for a coding-agent trace
    Given a stored coding-agent trace with log records
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the response carries the transcript entries the terminal view derives

  @unit
  Scenario: transcript endpoint answers empty for a trace without coding-agent content
    Given a stored trace that is not coding-agent origin
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the response carries an empty transcript list rather than an error

  # An API key carries no user session, so the data-privacy policy resolves the
  # caller as a public viewer: it may read a category the policy captures, and
  # nothing it restricts or drops. The transcript is derived from log records
  # whose event names each agent spells its own way, so these hold for every
  # agent, not only the one whose spelling the gate was first written against.

  @integration
  Scenario: transcript endpoint serves captured content to an API key caller
    Given a project whose captured input and output are both captured
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the prompt and the reply are in the transcript, whatever the agent

  @integration
  Scenario: transcript endpoint withholds restricted output from an API key caller
    Given a project whose captured output is restricted to an audience
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the assistant reply is withheld, whatever the agent

  @integration
  Scenario: transcript endpoint withholds restricted tool output from an API key caller
    Given a project whose captured output is restricted to an audience
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the output a tool returned is withheld

  @integration
  Scenario: transcript endpoint withholds restricted input from an API key caller
    Given a project whose captured input is restricted to an audience
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the user prompt is withheld, whatever the agent

  @integration
  Scenario: transcript endpoint withholds restricted tool arguments from an API key caller
    Given a project whose captured input is restricted to an audience
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then the instruction a tool was asked to run is withheld

  @integration
  Scenario: transcript endpoint withholds every content category a drop policy covers
    Given a project that drops captured input and output
    When GET /api/traces/{traceId}/transcript is called with a project API key
    Then no prompt, reply or tool content is in the transcript

  # Endpoint-level 404/409 semantics reuse the exact resolution path of
  # GET /:traceId (TraceService.getById incl. prefix resolution); an
  # endpoint-harness integration test is the right binding once one exists
  # for the traces REST surface.
  @integration @unimplemented
  Scenario: transcript endpoint rejects an unknown trace
    When GET /api/traces/{traceId}/transcript is called for a trace id that does not exist
    Then the request fails with a not found error

  @unit
  Scenario: the CLI prints a trace transcript
    Given the transcript endpoint returns entries for a trace
    When I run "langwatch trace transcript that-trace-id"
    Then the transcript entries are printed to stdout
    And machine output mode prints the raw JSON document

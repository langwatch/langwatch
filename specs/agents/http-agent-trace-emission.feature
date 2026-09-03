# Renamed from `http-agent-tracing.feature` when the platform application's
# second specs root merged into this one. `http-agent-tracing.feature` is a
# different feature that happened to share the filename: it covers what a
# reviewer sees on the Traces page and what redaction hides. This one covers
# what the executor emits — the agentId gate and traceparent propagation.
Feature: HTTP Agent Test Tracing
  When a user tests an HTTP agent from the drawer,
  the system creates a trace capturing request/response details
  with sensitive auth credentials redacted.

  Background:
    Given the user has an HTTP agent configured
    And the agent has an agentId

  @unit
  Scenario: Successful request creates a trace
    When the user executes a test request
    Then a trace is submitted to the collector
    And the trace includes the agent ID
    And the trace includes the project ID
    And the trace includes the user ID
    And the trace captures the response status code
    And the trace captures request duration
    And the trace captures the response body

  @unit
  Scenario: Failed request creates a trace
    When the user executes a test request to an endpoint returning 404
    Then a trace is submitted with error details
    And the span error flag is set

  @unit
  Scenario: Unreachable endpoint creates a trace
    When the user executes a test request to an unreachable endpoint
    Then a trace is submitted with the connection error

  Scenario: Invalid JSON body creates a trace
    When the user executes a test request with invalid JSON body
    Then a trace is submitted with the parse error
    And the error message indicates invalid JSON

  @unit
  Scenario: JSONPath extraction is captured in trace
    When the user executes a test request with an output path configured
    Then the trace captures the extracted output value

  @unit
  Scenario: Bearer token is redacted in trace
    When the user executes a test request with bearer authentication
    Then the Authorization header in the trace shows "Bearer [REDACTED]"

  @unit
  Scenario: API key is redacted in trace
    When the user executes a test request with API key authentication
    Then the custom auth header in the trace shows "[REDACTED]"

  @unit
  Scenario: Basic auth credentials are redacted in trace
    When the user executes a test request with basic authentication
    Then the Authorization header in the trace shows "Basic [REDACTED]"

  @unit
  Scenario: No trace without agentId
    Given the agent does not have an agentId
    When the user executes a test request
    Then no trace is submitted

  @unit
  Scenario: Traceparent header enables distributed tracing
    When the user executes a test request
    Then the outgoing HTTP request includes a traceparent header
    And the traceparent header follows W3C format "00-{traceId}-{spanId}-01"
    And the trace ID in the traceparent matches the submitted trace

  @unit
  Scenario: No traceparent without agentId
    Given the agent does not have an agentId
    When the user executes a test request
    Then the outgoing HTTP request does not include a traceparent header

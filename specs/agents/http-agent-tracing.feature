@issue:1058
Feature: HTTP Agent Test Tracing
  As a user testing HTTP agents
  I want test executions to create traces
  So that I can review request/response details and debug agent behavior on the Traces page

  # GitHub Issue: https://github.com/langwatch/langwatch/issues/1058
  #
  # Currently, httpProxy.execute sends HTTP requests when testing agents
  # but does not create traces. This feature adds tracing to HTTP agent
  # test executions so they appear on the Traces page.

  Background:
    Given I have an HTTP agent configured to call an external API

  # ============================================================================
  # Trace creation - happy path
  # ============================================================================

  @e2e
  Scenario: Test execution creates a trace visible on the Traces page
    Given I am viewing the HTTP agent in the agent drawer
    When I click "Test"
    And the request completes successfully
    Then a trace appears on the Traces page

  # ============================================================================
  # Trace metadata
  # ============================================================================

  @unit
  Scenario: Trace includes agent_test type
    When I execute an HTTP agent test
    Then the trace has type "agent_test"

  @unit
  Scenario: Trace includes agent ID
    When I execute an HTTP agent test for agent "My API Agent"
    Then the trace metadata includes the agent ID

  @unit
  Scenario: Trace includes project ID
    When I execute an HTTP agent test
    Then the trace metadata includes the project ID

  @unit
  Scenario: Trace includes user ID
    When I execute an HTTP agent test
    Then the trace metadata includes the user ID

  # ============================================================================
  # Ingestion
  #
  # The test span goes in through the same seam every customer span uses. It
  # used to be handed straight to the trace pipeline instead, in the wire shape
  # the pipeline does not accept, so the span was never attributed to its trace
  # and the trace reached no read model — recorded, and readable nowhere.
  # ============================================================================

  @unit
  Scenario: The test span is recorded against the trace it belongs to
    When I execute an HTTP agent test
    Then the recorded span is attributed to the test's trace
    And the trace is written to the traces read model

  # ============================================================================
  # Request details captured in trace
  #
  # The remaining @unimplemented "request details" scenarios assert on
  # `test_context` shape — needs an integration test that snapshots the
  # full trace_context object, not the per-field assertions in
  # `httpProxyTracing.integration.test.ts`. Cheap to add when someone
  # touches the request-context capture path.
  # ============================================================================

  @unit @unimplemented
  Scenario: Trace captures request URL and method
    When I execute an HTTP agent test
    Then the trace test_context includes the request URL
    And the trace test_context includes the request method

  @unit @unimplemented
  Scenario: Trace captures request body
    When I execute an HTTP agent test with a request body
    Then the trace captures the request body

  @unit @unimplemented
  Scenario: Trace captures output path when configured
    Given the agent has an output extraction path configured
    When I execute an HTTP agent test
    Then the trace test_context includes the output path

  # ============================================================================
  # Response details captured in trace
  # ============================================================================

  @integration
  Scenario: Trace captures response status code
    When I execute an HTTP agent test against a working endpoint
    Then the trace captures the response status code

  @integration
  Scenario: Trace captures response duration
    When I execute an HTTP agent test
    Then the trace captures the request duration in milliseconds

  @integration
  Scenario: Trace captures response body
    When I execute an HTTP agent test against a working endpoint
    Then the trace captures the response body

  @integration
  Scenario: Trace captures extracted output
    Given the agent has an output extraction path configured
    When I execute an HTTP agent test against a working endpoint
    Then the trace captures the extracted output value

  # ============================================================================
  # Error tracing
  # ============================================================================

  @integration
  Scenario: Trace captures HTTP error responses
    Given the endpoint returns an error status
    When I execute an HTTP agent test
    Then the trace captures the error response

  @integration
  Scenario: Trace captures connection failures
    Given the endpoint is unreachable
    When I execute an HTTP agent test
    Then the trace captures the connection error message

  @integration
  Scenario: Trace captures a request body that is not valid JSON
    Given the request body is not valid JSON
    When I execute an HTTP agent test
    Then a trace is still submitted
    And the span is flagged as errored
    And the span error message says the request body JSON is invalid

  # ============================================================================
  # Distributed tracing
  #
  # The test execution propagates W3C trace context to the endpoint it calls,
  # so the customer's own instrumentation joins the same trace.
  # ============================================================================

  @integration
  Scenario: Outgoing request carries a W3C traceparent header
    When I execute an HTTP agent test
    Then the outgoing HTTP request includes a traceparent header
    And the traceparent header follows the W3C format "00-{traceId}-{spanId}-01"

  @integration
  Scenario: The traceparent trace ID matches the submitted trace
    When I execute an HTTP agent test
    Then the trace ID inside the traceparent header is the ID of the submitted trace

  # ============================================================================
  # Not an agent test
  #
  # Without an agent ID the proxy is a plain request, not an agent test — it
  # must neither create a trace nor join one.
  # ============================================================================

  @integration
  Scenario: No trace is created when there is no agent ID
    Given the request carries no agent ID
    When I execute the request through the HTTP proxy
    Then no trace is submitted

  @integration
  Scenario: No traceparent header is sent when there is no agent ID
    Given the request carries no agent ID
    When I execute the request through the HTTP proxy
    Then the outgoing HTTP request does not include a traceparent header

  # ============================================================================
  # Auth credential sanitization
  # ============================================================================

  @unit
  Scenario: Bearer token credentials are redacted from trace
    Given the agent uses bearer token authentication
    When I execute an HTTP agent test
    Then the trace test_context includes has_auth as true
    And the trace does not contain the bearer token value

  @unit
  Scenario: API key credentials are redacted from trace
    Given the agent uses API key authentication
    When I execute an HTTP agent test
    Then the trace test_context includes has_auth as true
    And the trace does not contain the API key value

  @unit
  Scenario: Basic auth credentials are redacted from trace
    Given the agent uses basic authentication
    When I execute an HTTP agent test
    Then the trace test_context includes has_auth as true
    And the trace does not contain the username or password

  @unit
  Scenario: Authorization headers are redacted in captured request headers
    Given the agent uses bearer token authentication
    When I execute an HTTP agent test
    Then any Authorization header in the trace is redacted

  @unit
  Scenario: Custom auth headers are redacted in captured request headers
    Given the agent uses API key authentication with a custom header
    When I execute an HTTP agent test
    Then the custom auth header value in the trace is redacted

  # ============================================================================
  # Filtering
  #
  # @unimplemented: needs an end-to-end test that POSTs traces, then queries
  # the traces API with a `type=agent_test` filter and asserts the result
  # set. The httpProxyTracing.integration.test.ts focuses on trace-creation
  # mechanics rather than the read/filter side.
  # ============================================================================

  @integration @unimplemented
  Scenario: Filter traces by agent_test type
    Given multiple agent test traces exist
    And other trace types exist
    When I filter traces by type "agent_test"
    Then only agent test traces are returned

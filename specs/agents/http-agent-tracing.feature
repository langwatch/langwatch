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

  @e2e @unimplemented
  Scenario: Test execution creates a trace visible on the Traces page
    Given I am viewing the HTTP agent in the agent drawer
    When I click "Test"
    And the request completes successfully
    Then a trace appears on the Traces page

  # ============================================================================
  # Trace metadata
  # ============================================================================

  @unit @unimplemented
  Scenario: Trace includes agent_test type
    When I execute an HTTP agent test
    Then the trace has type "agent_test"

  @unit @unimplemented
  Scenario: Trace includes agent ID
    When I execute an HTTP agent test for agent "My API Agent"
    Then the trace metadata includes the agent ID

  @unit @unimplemented
  Scenario: Trace includes project ID
    When I execute an HTTP agent test
    Then the trace metadata includes the project ID

  @unit @unimplemented
  Scenario: Trace includes user ID
    When I execute an HTTP agent test
    Then the trace metadata includes the user ID

  # ============================================================================
  # Request details captured in trace
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

  @integration @unimplemented
  Scenario: Trace captures response status code
    When I execute an HTTP agent test against a working endpoint
    Then the trace captures the response status code

  @integration @unimplemented
  Scenario: Trace captures response duration
    When I execute an HTTP agent test
    Then the trace captures the request duration in milliseconds

  @integration @unimplemented
  Scenario: Trace captures response body
    When I execute an HTTP agent test against a working endpoint
    Then the trace captures the response body

  @integration @unimplemented
  Scenario: Trace captures extracted output
    Given the agent has an output extraction path configured
    When I execute an HTTP agent test against a working endpoint
    Then the trace captures the extracted output value

  # ============================================================================
  # Error tracing
  # ============================================================================

  @integration @unimplemented
  Scenario: Trace captures HTTP error responses
    Given the endpoint returns an error status
    When I execute an HTTP agent test
    Then the trace captures the error response

  @integration @unimplemented
  Scenario: Trace captures connection failures
    Given the endpoint is unreachable
    When I execute an HTTP agent test
    Then the trace captures the connection error message

  # ============================================================================
  # Auth credential sanitization
  # ============================================================================

  @unit @unimplemented
  Scenario: Bearer token credentials are redacted from trace
    Given the agent uses bearer token authentication
    When I execute an HTTP agent test
    Then the trace test_context includes has_auth as true
    And the trace does not contain the bearer token value

  @unit @unimplemented
  Scenario: API key credentials are redacted from trace
    Given the agent uses API key authentication
    When I execute an HTTP agent test
    Then the trace test_context includes has_auth as true
    And the trace does not contain the API key value

  @unit @unimplemented
  Scenario: Basic auth credentials are redacted from trace
    Given the agent uses basic authentication
    When I execute an HTTP agent test
    Then the trace test_context includes has_auth as true
    And the trace does not contain the username or password

  @unit @unimplemented
  Scenario: Authorization headers are redacted in captured request headers
    Given the agent uses bearer token authentication
    When I execute an HTTP agent test
    Then any Authorization header in the trace is redacted

  @unit @unimplemented
  Scenario: Custom auth headers are redacted in captured request headers
    Given the agent uses API key authentication with a custom header
    When I execute an HTTP agent test
    Then the custom auth header value in the trace is redacted

  # ============================================================================
  # Filtering
  # ============================================================================

  @integration @unimplemented
  Scenario: Filter traces by agent_test type
    Given multiple agent test traces exist
    And other trace types exist
    When I filter traces by type "agent_test"
    Then only agent test traces are returned

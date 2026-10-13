Feature: Diagnostic logging on auth failure
  As an on-call engineer triaging customer reports of "events aren't arriving"
  I want auth-failure logs to carry enough request fingerprint detail
  So that I can identify which customer is sending bad credentials within minutes
  Without having to ask the customer to enable debug mode and reproduce

  Background:
    Given the OTLP ingest door resolves the credential of each export
    And a request reaches the door

  @unit
  Scenario: A request with no credential header is logged with its fingerprint
    When the request has no Authorization, X-Auth-Token, or X-Project-Id headers
    Then the door emits a single WARN-level "Authentication failed" log line
    And the log line contains userAgent, traceparent, forwardedFor, path, method
    And the log line records hasEmptyAuthToken=false (no header at all)

  @unit
  Scenario: An empty X-Auth-Token is logged as an empty-token submission
    When the request has X-Auth-Token: "" (empty string)
    Then the door emits a single WARN-level log line
    And the log line records hasEmptyAuthToken=true
    And the message specifically calls out an empty-token submission so the
      caller knows their api_key resolved to an empty string

  @unit @unimplemented
  Scenario: Resolver returns null because credentials don't match any project
    # Unimplemented: the diagnostic fields (extractCredentials, collectAuthDiagnostics)
    # are unit-tested, but the WARN-level log emission itself has no test fixture
    # that observes the actual logger output for this path.
    Given the request carries a valid-looking but unknown api key
    When the resolver fails to resolve the token to a project
    Then the existing "Authentication failed: invalid credentials" log fires
    And userAgent, traceparent, and x-forwarded-for are also present in that log

  @unit @unimplemented
  Scenario: Successful auth does not emit the diagnostic log
    # Unimplemented: no test fixture observes the logger to confirm the
    # diagnostic log is actually withheld on the success path.
    Given the request carries valid credentials
    When the middleware passes auth
    Then no diagnostic auth-failure log is emitted

  @unit
  Scenario: Diagnostic fields are safe to log
    Then the log NEVER includes the raw token value
    And the log NEVER includes the request body

  @unit
  Scenario: Authorization header from a proxy does not poison X-Auth-Token fallback
    Given a corporate proxy injects "Authorization: Basic <its-own-base64>" into the request
    And the customer's request also carries "X-Auth-Token: <valid-key>"
    When the middleware runs extractCredentials
    Then the credential extraction uses X-Auth-Token, which wins over Authorization: Basic
    And the customer's legitimate token is used for project resolution
    And the request is not 401'd by the proxy header

  @unit
  Scenario: Authorization Basic is read when no X-Auth-Token is sent
    Given a request carries "Authorization: Basic" holding a project id and a key
    And the request carries no X-Auth-Token
    When the middleware runs extractCredentials
    Then the key is taken from the Basic credential, with its project id

  @unit
  Scenario: Empty or whitespace-only Bearer token does not poison X-Auth-Token fallback
    Given a request carries "Authorization: Bearer " (empty or whitespace-only)
    And the same request carries "X-Auth-Token: <valid-key>"
    When the middleware runs extractCredentials
    Then it falls through and returns the X-Auth-Token credential

Feature: Diagnostic logging on auth failure
  As an on-call engineer triaging customer reports of "events aren't arriving"
  I want auth-failure logs to carry enough request fingerprint detail
  So that I can identify which customer is sending bad credentials within minutes
  Without having to ask the customer to enable debug mode and reproduce

  Background:
    Given the unified auth middleware is mounted on a Hono route
    And a request reaches the middleware

  @unit
  Scenario: extractCredentials returns null because no auth header was sent
    When the request has no Authorization, X-Auth-Token, or X-Project-Id headers
    Then the middleware emits a single WARN-level log line at "langwatch:api:unified-auth"
    And the log line contains userAgent, traceparent, x-forwarded-for, path, method
    And the log line records hasEmptyAuthToken=false (no header at all)

  @unit
  Scenario: extractCredentials returns null because X-Auth-Token was sent empty
    When the request has X-Auth-Token: "" (empty string)
    Then the middleware emits a single WARN-level log line at "langwatch:api:unified-auth"
    And the log line records hasEmptyAuthToken=true
    And the message specifically calls out an empty-token submission so the
      caller knows their api_key resolved to an empty string

  @unit
  Scenario: Resolver returns null because credentials don't match any project
    Given the request carries a valid-looking but unknown api key
    When the resolver fails to resolve the token to a project
    Then the existing "Authentication failed: invalid credentials" log fires
    And userAgent, traceparent, and x-forwarded-for are also present in that log

  @unit
  Scenario: Successful auth does not emit the diagnostic log
    Given the request carries valid credentials
    When the middleware passes auth
    Then no diagnostic auth-failure log is emitted

  @unit
  Scenario: Diagnostic fields are safe to log
    Then the log NEVER includes the raw token value
    And the log NEVER includes the request body
    And only the prefix of the token (first 8 chars) is included when the resolver path is taken

  @unit
  Scenario: Authorization header from a proxy does not poison X-Auth-Token fallback
    Given a corporate proxy injects "Authorization: Basic <its-own-base64>" into the request
    And the customer's request also carries "X-Auth-Token: <valid-key>"
    When the middleware runs extractCredentials
    Then the credential extraction must fall back to X-Auth-Token
    And the customer's legitimate token is used for project resolution
    And the request is not 401'd by the proxy header

  @unit
  Scenario: Empty or whitespace-only Bearer token does not poison X-Auth-Token fallback
    Given a request carries "Authorization: Bearer " (empty or whitespace-only)
    And the same request carries "X-Auth-Token: <valid-key>"
    When the middleware runs extractCredentials
    Then it falls through and returns the X-Auth-Token credential

Feature: HTTP agent error surfacing and per-call diagnostics
  As a LangWatch engineer debugging a failing scenario
  I want every HTTP-agent call to surface enough context to diagnose without re-running
  So that the next 422 (or any non-2xx) captures itself in production logs

  # Context: when an HTTP agent (e.g. n8n webhook) returns a non-2xx,
  # SerializedHttpAgentAdapter today throws `HTTP <status>: <statusText>` and
  # discards the response body, request URL, and upstream identifiers. That
  # leaves on-call with nothing to act on. This feature teaches the adapter
  # to (1) include response body + URL + upstream request-id on the thrown
  # error, and (2) emit a structured per-call log line so the next failure
  # is captured even if it doesn't recur.
  #
  # Out of scope (tracked separately):
  #   - Confirming the upstream cause of production 422s — #3590
  #   - Per-suite / per-run-plan concurrency option — #3644

  # ============================================================================
  # AC #2 — Error context on non-2xx responses
  # ============================================================================

  @integration
  Scenario: HTTP agent error includes response body, URL, and upstream request id
    Given an HTTP agent target pointed at a stub returning 422 with a JSON error body
    And the stub sets an "x-request-id" response header
    When the adapter calls the stub
    Then the thrown error message contains the request URL
    And the thrown error message contains the response status 422
    And the thrown error message contains the response body
    And the thrown error message contains the value of the "x-request-id" response header

  @integration
  Scenario: HTTP agent error truncates large response bodies
    Given an HTTP agent target pointed at a stub returning 500 with a body larger than the truncation limit
    When the adapter calls the stub
    Then the thrown error message contains a truncated portion of the body
    And the thrown error message indicates the body was truncated

  @integration
  Scenario: HTTP agent error reads non-JSON response bodies as text
    Given an HTTP agent target pointed at a stub returning 502 with a plain-text body
    When the adapter calls the stub
    Then the thrown error message contains the plain-text body

  @integration
  Scenario: HTTP agent error surfaces alternate upstream identifier headers
    Given an HTTP agent target pointed at a stub returning 422 with no "x-request-id" header
    And the stub sets an "x-amzn-requestid" response header
    When the adapter calls the stub
    Then the thrown error message contains the value of the "x-amzn-requestid" header

  @unit
  Scenario: HTTP agent error redacts sensitive request headers
    Given a request that sets "Authorization" and "x-api-key" headers
    When the adapter formats those request headers for logging or error context
    Then the formatted output replaces the values of "Authorization" and "x-api-key" with a redacted placeholder

  # ============================================================================
  # AC #3 — Per-call diagnostic logging (formerly AC #4 in the issue body
  # before the concurrency-regression AC was dropped)
  # ============================================================================

  @integration
  Scenario: HTTP agent emits one diagnostic log line per successful call
    Given an HTTP agent target pointed at a stub returning 200
    When the adapter calls the stub
    Then exactly one structured diagnostic log line is emitted
    And the log line includes the request URL
    And the log line includes the HTTP method
    And the log line includes the response status
    And the log line includes a duration in milliseconds
    And the log line includes the upstream request id (if present in the response headers)

  @integration
  Scenario: HTTP agent emits one diagnostic log line per failing call
    Given an HTTP agent target pointed at a stub returning 422
    When the adapter calls the stub
    Then exactly one structured diagnostic log line is emitted
    And the log line includes the response status 422
    And the log line includes a redacted, truncated sample of the response body

  @integration
  Scenario: Diagnostic log preserves response body for the success path
    Given an HTTP agent target pointed at a stub returning a JSON 200 response
    When the adapter calls the stub
    Then the diagnostic log line is emitted
    And the adapter still returns the parsed JSON response to its caller

  @unit
  Scenario: Diagnostic log redacts sensitive request headers
    Given a request that sets "Authorization" and "x-api-key" headers
    When the diagnostic log line is emitted for that request
    Then the values of "Authorization" and "x-api-key" do not appear in the log line
    And the redacted placeholder appears in their place

  # --- AC Coverage Map ---
  # AC #1: "Root cause for parallel-mode 422s identified and documented" → OUT OF SCOPE in this PR.
  #        Issue body explicitly defers to #3590; depends on a real failure being captured AFTER
  #        AC #2 + AC #3 ship in production. No scenarios mapped here by design.
  # AC #2: "HTTP agent errors include response body, URL, upstream identifier" →
  #        Scenario "HTTP agent error includes response body, URL, and upstream request id"
  #        Scenario "HTTP agent error truncates large response bodies"
  #        Scenario "HTTP agent error reads non-JSON response bodies as text"
  #        Scenario "HTTP agent error surfaces alternate upstream identifier headers"
  #        Scenario "HTTP agent error redacts sensitive request headers"
  # AC #3: "Diagnostic logging emitted on every HTTP-agent call (not only failures)" →
  #        Scenario "HTTP agent emits one diagnostic log line per successful call"
  #        Scenario "HTTP agent emits one diagnostic log line per failing call"
  #        Scenario "Diagnostic log preserves response body for the success path"
  #        Scenario "Diagnostic log redacts sensitive request headers"

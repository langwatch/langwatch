Feature: Gateway errors are logged with fault attribution
  As an operator of the gateway
  I want every failed request logged with who the failure is on
  So that I can alert on error increases before customers report them, and
    tell customer-caused failures apart from platform problems

  Background:
    Failures must be visible in logs (picked up by CloudWatch) even when the
    response correctly forwards the provider's error to the client. Every
    failure carries a fault attribution:
      - customer: caused by the caller (out of credits, invalid key, bad
        request, model not allowed) — logged at info
      - provider: the upstream LLM provider failed or timed out — logged at
        warn
      - platform: our bug or infrastructure problem — logged at error
    Customer faults are still logged because a spike in them can be a false
    flag for a platform problem.

    # Bindings: services/aigateway/adapters/httpapi/faults_test.go
    # Choke point: services/aigateway/adapters/httpapi/router.go (writeError)

  @unit
  Scenario: A provider error response is logged with provider fault
    Given the upstream provider returns a server error or times out
    When the gateway forwards the error to the client
    Then a warn log records the failure with provider fault, status and message

  @unit
  Scenario: A customer-caused provider rejection is logged with customer fault
    Given the upstream provider rejects the request as out of credits or unauthorized
    When the gateway forwards the rejection to the client
    Then an info log records the failure with customer fault, status and message

  @unit
  Scenario: A gateway-classified error is logged by its error code
    Given the gateway rejects or fails a request with one of its own error codes
    When the error response is written
    Then the failure is logged with the fault attribution of that code

  @unit
  Scenario: An unexpected error is logged with platform fault
    Given a request fails with an error the gateway does not recognize
    When the generic internal error is returned
    Then an error log records the failure with platform fault

  @unit
  Scenario: Failure logs identify the calling project
    Given an authenticated request fails
    When the failure is logged
    Then the log carries the project, organization and virtual key identifiers

  # Logging customer faults at info is right, and it is also why they cannot be
  # alerted on: one client looping on a body the gateway rejects can produce
  # six figures of rejections in a week without moving anything an operator
  # watches. gateway_http_requests_total cannot answer "who", either — a
  # request rejected before model resolution is counted with model=unknown and
  # no caller identity at all.
  @unit
  Scenario: A customer-fault rejection is counted against the key that sent it
    Given an authenticated request is rejected as the caller's fault
    When the error response is written
    Then the rejection is counted against its error code and virtual key
    And the count carries no project or model label, because those are
      redundant with the key and caller-controlled respectively

  @unit
  Scenario: A provider or platform failure is not counted as a client rejection
    Given a request fails upstream or through a gateway bug
    When the error response is written
    Then the client-rejection counter does not move
    Because it exists to name a misbehaving client, not to double-count outages

  @unit
  Scenario: A rejection on an unmetered path is still written
    Given a request that never passed through the metrics middleware fails
    When the error response is written
    Then the response and the log are unaffected
    And nothing panics for want of a recorder

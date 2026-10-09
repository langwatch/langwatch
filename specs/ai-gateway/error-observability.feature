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

  # The forwarded response holds the provider's own sentence, and the log line
  # held only our summary of it ("codex backend HTTP 400"). A production outage
  # on codex models took a live probe of the backend to name, because the one
  # place an operator looks never carried the reply that said "Unsupported
  # parameter: prompt_cache_retention".
  @unit
  Scenario: A forwarded provider rejection names the provider's own reason
    Given the upstream provider rejects the request with a reason in its body
    When the gateway forwards the rejection to the client
    Then the operator reads that reason next to the status
    And a rejection worded in any of the ways providers word it reads the same
    And a body that states no reason is described, never quoted, so nothing the customer sent can reach the log
    And a reason our own message already states is not repeated

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

  # A failure that used to be a forwarded provider response was attributed
  # from the status on that response. Once the gateway authors it as a handled
  # error there is no response to read, so the code must carry the attribution
  # itself — otherwise a routine customer condition (a dead Codex sign-in)
  # lands on the platform-fault line operators page on.
  @unit
  Scenario: A customer-caused failure the gateway authors keeps its customer fault
    Given the customer's own provider session has died and only they can restore it
    When the gateway answers with its own handled error instead of forwarding a provider response
    Then an info log records the failure with customer fault
    And the rejection is counted against its error code and virtual key

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
  #
  # Bindings: services/aigateway/adapters/gatewaymetrics/metrics_test.go,
  # services/aigateway/adapters/httpapi/metrics_route_test.go
  @unit
  Scenario: A customer-fault rejection is counted against the key that sent it
    Given an authenticated request is rejected as the caller's fault
    When the error response is written
    Then the rejection is counted against its error code and virtual key
    And a missing-model rejection is counted as "missing_model", not generic "bad_request"
    # Project is redundant with the key; model is caller-controlled.
    And the count carries no project or model label

  # The counter exists to name a misbehaving client, not to double-count outages.
  @unit
  Scenario: A provider or platform failure is not counted as a client rejection
    Given a request fails upstream or through a gateway bug
    When the error response is written
    Then the client-rejection counter does not move

  # A key sitting at its configured ceiling sustains rejections by design, and
  # rate limiting already has its own counter with its own dimension label.
  @unit
  Scenario: A rate-limited caller is not counted as a client reject
    Given an authenticated request is denied by a gateway rate limit
    When the error response is written
    Then the client-rejection counter does not move
    And the denial is carried by the dedicated rate-limit counter instead

  @unit
  Scenario: A rejection on an unmetered path is still written
    Given a request that never passed through the metrics middleware fails
    When the error response is written
    Then the response and the log are unaffected
    And nothing panics for want of a recorder

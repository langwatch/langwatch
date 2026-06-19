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

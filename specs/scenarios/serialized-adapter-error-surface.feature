Feature: Serialized adapters surface user-vs-infra failures distinctly
  As a customer-support engineer triaging a failed scenario run
  I need each adapter failure to clearly say whether user code or infra is at fault
  So I don't have to do stderr archaeology to start debugging.

  Background: tracking lw#3439. Customer report 2026-04-24 surfaced
  "[SerializedCodeAgentAdapter] Error: Code execution failed: HTTP 500 - The
  read operation timed out" with no endpoint, no separation between user code
  and infra errors, and AI SDK / OTEL noise interleaved with the real cause.

  @unit
  Scenario: adapter labels HTTP 500 with detail as a user-code failure
    Given the NLP service returns HTTP 500 with a Python traceback in `detail`
    When SerializedCodeAgentAdapter.call rejects
    Then the error is a SerializedCodeAgentAdapterError with source="user_code"
    And the message includes the endpoint and "user code raised"
    And the message includes the original Python exception class name

  @unit
  Scenario: adapter labels non-500 status as an NLP service failure
    Given the NLP service returns HTTP 503
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="nlp_service" and httpStatus=503
    And the message starts with "NLP service returned HTTP 503"

  @unit
  Scenario: adapter strips AI SDK warnings and OTEL noise from the surfaced message
    Given the NLP service returns HTTP 500 with a `detail` containing AI SDK warnings and OTEL flush lines
    When SerializedCodeAgentAdapter.call rejects
    Then the surfaced message no longer contains those noise lines
    And the rawDetail field on the error preserves the original blob

  @unit
  Scenario: adapter truncates long error bodies but preserves them on rawDetail
    Given the NLP service returns HTTP 500 with a 10000-char `detail`
    When SerializedCodeAgentAdapter.call rejects
    Then the rendered message is shorter than the original detail
    And the message ends with a "truncated, original was 10000 chars" marker
    And the rawDetail field on the error preserves the original blob

  @unit
  Scenario: adapter labels a fetch failure as a network error
    Given fetch rejects with a TypeError before the response is received
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="network"
    And the message includes "failed to reach NLP service"

  @unit
  Scenario: adapter labels an aborted fetch as a timeout
    Given the NLP service does not respond within the adapter timeout
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="timeout"
    And the message includes the configured timeout in milliseconds

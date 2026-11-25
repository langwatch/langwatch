Feature: Serialized adapters surface user-vs-infra failures distinctly
  As a customer-support engineer triaging a failed scenario run
  I need each adapter failure to clearly say whether user code or infra is at fault
  So I don't have to do stderr archaeology to start debugging.

  Background: tracking lw#3439. Customer report 2026-04-24 surfaced
  "[SerializedCodeAgentAdapter] Error: Code execution failed: HTTP 500 - The
  read operation timed out" with no endpoint, no separation between user code
  and infra errors, and AI SDK / OTEL noise interleaved with the real cause.

  The adapter dials /go/studio/execute_sync, which is served by the Go NLP
  engine. That engine reports every failure as an error envelope carrying an
  error type, so the user-vs-infra split is decided by that type — a failure
  the engine attributes to the customer is a user-code failure, anything else
  is an infra failure.

  @unit
  Scenario: adapter labels an engine failure attributed to the customer as a user-code failure
    Given the NLP engine returns an error envelope whose type it attributes to the customer
    When SerializedCodeAgentAdapter.call rejects
    Then the error is a SerializedCodeAgentAdapterError with source="user_code"
    And the message includes "user code raised"
    And the message includes the original Python exception class name
    And the message does not leak the internal NLP endpoint host
    And the error's structured endpoint field still carries the endpoint for operators

  @unit
  Scenario: a failed run is surfaced as an error instead of an empty agent reply
    Given the NLP engine accepts the request and then finalizes the run as failed
    When SerializedCodeAgentAdapter.call is awaited
    Then the call rejects with a SerializedCodeAgentAdapterError
    And it does not resolve with an empty string

  @unit
  Scenario: adapter labels an engine failure attributed to the platform as an NLP service failure
    Given the NLP engine returns an error envelope whose type it attributes to the platform
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="nlp_service"
    And the message says the NLP service failed while running the workflow
    And the message does not claim user code raised the error

  @unit
  Scenario: adapter does not blame user code for a rejected API key
    Given the NLP engine rejects the request because the adapter's own credential is invalid
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="nlp_service"
    And the message does not claim user code raised the error

  @unit
  Scenario: adapter still understands the legacy detail-only error envelope
    Given the NLP service returns HTTP 500 with a Python traceback in `detail`
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="user_code"
    And the message includes "user code raised"

  @unit
  Scenario: adapter labels a status it cannot attribute as an NLP service failure
    Given the NLP service returns HTTP 503 with no recognisable error envelope
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="nlp_service" and httpStatus=503
    And the message starts with "NLP service returned HTTP 503"

  @unit
  Scenario: adapter preserves a non-JSON error body instead of dropping it
    Given the NLP service returns HTTP 502 whose body is an HTML proxy error page
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="nlp_service"
    And the message includes the text of the HTML body
    And the message does not render the body as empty

  @unit
  Scenario: adapter does not crash when the error envelope carries a non-string detail
    Given the NLP service returns HTTP 500 whose `detail` is a list of validation errors
    When SerializedCodeAgentAdapter.call rejects
    Then the error is a SerializedCodeAgentAdapterError, not a formatter crash
    And the message includes the validation error text

  @unit
  Scenario: adapter strips AI SDK warnings and OTEL noise from the surfaced message
    Given the NLP engine returns an error message containing AI SDK warnings and OTEL flush lines
    When SerializedCodeAgentAdapter.call rejects
    Then the surfaced message no longer contains those noise lines
    And the rawDetail field on the error preserves the original blob

  @unit
  Scenario: adapter truncates long error bodies but preserves them on rawDetail
    Given the NLP engine returns an error message of 10000 characters
    When SerializedCodeAgentAdapter.call rejects
    Then the rendered message is shorter than the original detail
    And the message ends with a "truncated, original was 10000 chars" marker
    And the message does not name an internal field the customer cannot reach
    And the rawDetail field on the error preserves the original blob

  @unit
  Scenario: adapter labels a fetch failure as a network error
    Given fetch rejects with a TypeError before the response is received
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="network"
    And the message includes "failed to reach NLP service"

  @unit
  Scenario: a fetch failure does not leak the internal NLP host and port
    Given fetch rejects with a connection error naming the internal host and port
    When SerializedCodeAgentAdapter.call rejects
    Then the message names the connection failure code
    And the message does not contain the internal host or port

  @unit
  Scenario: adapter labels an aborted fetch as a timeout
    Given the NLP service does not respond within the adapter timeout
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="timeout"
    And the message includes the configured timeout in milliseconds

  @unit
  Scenario: a timeout while the response body is still streaming is surfaced as a timeout
    Given the NLP service sends headers and then stalls while the body is read
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="timeout"
    And the message includes the configured timeout in milliseconds

  @unit
  Scenario: adapter classifies a response recorded from the live engine
    Given a response body recorded verbatim from a running NLP engine whose user code raised
    When SerializedCodeAgentAdapter.call rejects
    Then the recorded response status is 200, not an error status
    And the error has source="user_code"
    And the message includes the original Python exception class name

  @unit
  Scenario: adapter does not blame user code for a workflow this adapter itself built
    Given the NLP engine reports that the submitted workflow could not be parsed
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="nlp_service"
    And the message does not claim user code raised the error

  @unit
  Scenario: a missing declared output leaves the same structured footprint as any other failure
    Given the agent run succeeds but omits the output field the agent declared
    When SerializedCodeAgentAdapter.call rejects
    Then the error is a SerializedCodeAgentAdapterError with source="user_code"
    And the failure is recorded on the span like every other failure

  @unit
  Scenario: a success response that is not valid JSON is surfaced as its own failure kind
    Given the NLP service answers 200 with a body that is not valid JSON
    When SerializedCodeAgentAdapter.call rejects
    Then the error has source="nlp_service"
    And the failure is not recorded as an HTTP failure

  @unit
  Scenario: a failure after the response arrived is not blamed on the response time
    Given the NLP service answers in full and the failure happens afterwards
    When SerializedCodeAgentAdapter.call rejects
    Then the message does not claim the service failed to respond in time

  @unit
  Scenario: the surfaced traceback keeps the customer's frames and drops the engine's own
    Given the NLP engine returns a traceback containing its own execution-harness frames
    When the failure is rendered for the customer
    Then the harness frames and their internal server path are gone
    And the customer's own frame and exception line remain

  @unit
  Scenario: a credential echoed back by the engine never reaches the customer
    Given the NLP engine's error text quotes the API key the adapter sent
    When SerializedCodeAgentAdapter.call rejects
    Then neither the message nor the raw detail contains the key

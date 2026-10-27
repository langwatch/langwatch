Feature: The SDK client throws instead of resolving undefined on an unreadable response
  As an engineer calling a LangWatch SDK client-sdk service method
  I want a response the transport could not read as data or as a named error
  to still raise the typed API error
  So that a failure surfaces at the call site instead of three lines later as
  "Cannot read properties of undefined"

  Background:
    Given a client-sdk service backed by a fake apiClient

  # D12: openapi-fetch's own empty-body short-circuit answers a non-2xx
  # response with neither `data` nor a parsed `error` when the body is
  # unreadable (an empty 502 page from a proxy, a truncated response). Left
  # unguarded, `if (error) …; return data;` resolves the promise with
  # `undefined`.
  @unit
  Scenario: A 502 with an unreadable body rejects with the typed API error naming the operation and the status
    Given the apiClient answers with no data and no parsed error on a 502 response
    When a service method that promises data calls the API
    Then the call rejects with the service's typed API error
    And the error names the operation being attempted
    And the error carries the HTTP status 502

  @unit
  Scenario: A 200 with an empty body on a method that promises data rejects rather than resolving undefined
    Given the apiClient answers with no data and no error on a 200 response
    When a service method that promises data calls the API
    Then the call rejects with the service's typed API error
    And the error names the operation being attempted

  @unit
  Scenario: A 204 on a method that promises nothing still resolves
    Given the apiClient answers with no data and no error on a 204 response
    When a service method that promises no data calls the API
    Then the call resolves without throwing

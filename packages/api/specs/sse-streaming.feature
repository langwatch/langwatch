# See ../adrs/001-rpc-first-fluent-registration.md (its RPC half is withdrawn)
# See ../../specs/features/domain-error-contract.feature (the error-event
# payload contract this transport adopts for mid-stream handled failures)
Feature: SSE streaming endpoints

  As a feature author
  I want streaming endpoints whose misuse is impossible to express
  So that a stream is always a GET, never carries a body, and every emitted
  event is validated against its declared schema

  Background:
    Given a service created with createService

  @unit
  Scenario: An SSE endpoint is a dotted name mounted as a GET
    When the author calls registerSse with "things.watch", a version, a
      handler and a chain declaring its events
    Then the endpoint serves GET /api/things/{version}/things.watch
    And the route table counts it as a GET route

  @typecheck
  Scenario: A stream cannot declare a request body or path params
    Given a registerSse definition chain
    Then withInput and withParams are not offered
    And request data arrives through withQuery only

  @unit
  Scenario: Emitted events are validated against their declared schema
    Given an events map declaring "result" with a score field
    When the handler emits "result" with a conforming payload
    Then the event is serialized onto the stream

  # The validation-failure frame carries zod issues; a mid-stream HANDLED
  # failure carries the SerializedHandledError per domain-error-contract.
  # One stream, two error frames: a validation failure is an authoring bug
  # told to the caller, a handled error is a domain outcome told in the
  # domain's shape.
  @unit
  Scenario: A non-conforming emit fails loudly on the stream
    Given the same events map
    When the handler emits "result" with a payload that fails validation
    Then an "error" event carrying the issues is written to the stream
    And the emit rejects, so the handler must catch to continue streaming

  @unit
  Scenario: A handler error reaches the service error handler
    Given a streaming handler that throws
    When the stream is being served
    Then the error propagates to the service's error handling
    And the client sees a completed stream rather than a hung one

  @unit
  Scenario: Client disconnect settles the stream's completion
    Given a client that disconnects mid-stream
    When the request instrumentation asks for the stream's completion
    Then it settles rather than leaking

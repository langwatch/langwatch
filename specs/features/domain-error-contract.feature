Feature: Handled errors — the handled-error boundary

  Every error that crosses an API boundary is exactly one of two things, and the
  contract turns on the difference:

    - HANDLED — we understand it and the caller can act on it (not found,
      forbidden, not-owned, timeout, validation, conflict, rate-limited). It is a
      `HandledError` in TypeScript / an `herr.E` in Go, with a stable `code`
      (Go: `Code`), user-relevant `message`, structured `meta`, `traceId`/`spanId`,
      an `httpStatus`, and a `reasons` cause chain.
    - UNHANDLED — anything we did not anticipate (a database crash, a nil deref,
      an infra timeout, a bug). It is a plain `Error` / plain `error`. It has no
      user-relevant meaning and MUST NOT be dressed up as a handled error.

  The rule: only handled errors cross the boundary with meaning. An unhandled
  error is reported to the client as a single generic "unknown", its detail
  logged server-side against the trace id — never presented as an actionable API
  error. The presence of a serialised domain payload IS the signal of "handled".

  This contract is the same in both languages and applies everywhere. See
  ADR-045. The machinery already exists (`src/server/app-layer/handled-error.ts`,
  wired into tRPC's `errorFormatter` and Hono's `onError`); these scenarios pin
  its intended behaviour and its reach.

  Background:
    Given the HandledError base and its serialisation are available in the app layer
    And tRPC attaches a serialised handled error to `data.domainError`
    And Hono's `onError` normalises a HandledError to `{ error: code, message, ...meta }`

  # ==========================================================================
  # Handled: known, user-relevant failures cross the boundary with meaning
  # ==========================================================================

  @bdd @domain-errors
  Scenario: A known failure is serialised as a handled error over tRPC
    Given a procedure throws a NotFoundError of code "evaluation_not_found" with meta { id }
    When the client calls that procedure
    Then the tRPC error carries `data.domainError`
    And the handled error has code "evaluation_not_found"
    And its meta contains the requested id
    And its httpStatus is 404

  @bdd @domain-errors
  Scenario: A known failure is normalised by Hono to a client-safe body
    Given a service route throws a HandledError of code "conversation_not_owned" with httpStatus 403
    When the client calls that route
    Then the HTTP status is 403
    And the response body is { error: "conversation_not_owned", message, ...meta }
    And no stack trace or internal detail is present

  @bdd @domain-errors
  Scenario: httpStatus follows the failure class
    Given a NotFoundError, a ValidationError, a conflict, and a rate-limit handled error
    Then their httpStatus values are 404, 422, 409, and 429 respectively

  @bdd @domain-errors
  Scenario: Telemetry is captured from the active span
    Given a HandledError is constructed inside an active OTel span
    Then it carries that span's traceId and spanId
    And the client can link the error to its trace

  # ==========================================================================
  # Unhandled: internal failures degrade to "unknown"
  # ==========================================================================

  @bdd @domain-errors
  Scenario: A database crash is reported to the client as unknown
    Given a procedure throws a plain Error because the database connection dropped
    When the client calls that procedure
    Then `data.domainError` is null
    And the caller sees a generic "unknown" / internal error, not the raw message
    And the underlying error is logged server-side with the trace id

  @bdd @domain-errors
  Scenario: An unhandled reason inside a handled error is masked, not leaked
    Given an EvaluationNotFoundError is thrown with a plain database Error in its reasons
    When it is serialised
    Then the top-level code is "evaluation_not_found"
    And the database Error appears in reasons only as { code: "unknown" }
    And no database detail reaches the client

  @bdd @domain-errors
  Scenario: We never invent a handled error for an unknown cause
    Given a failure we cannot name (an unexpected bug)
    Then the code throws a plain Error, not a HandledError subclass
    And it correctly degrades to "unknown" at the boundary

  # ==========================================================================
  # Cross-language: handled-ness survives the Go ↔ TS boundary
  # ==========================================================================

  @bdd @domain-errors @unimplemented
  Scenario: A Go herr proxied by the control plane arrives as a handled error
    Given a Go service returns an herr.E with Code "github_unreachable" and a trace id
    When the control plane proxies that failure to the client
    Then it is adapted into a HandledError (Code → code, meta→meta, trace_id/span_id→traceId/spanId)
    And the client receives code "github_unreachable" with its meta and trace link

  @bdd @domain-errors @unimplemented
  Scenario: A plain Go error proxied by the control plane becomes unknown
    Given a Go service returns a plain error (not an herr.E)
    When the control plane proxies that failure to the client
    Then no domain payload is produced
    And the client sees the generic "unknown" treatment

  # ==========================================================================
  # Non-tRPC transports carry the same shape
  # ==========================================================================

  @bdd @domain-errors @unimplemented
  Scenario: A streamed response carries the serialised handled error on its error event
    Given a streamed endpoint (e.g. the Langy chat stream) hits a known failure mid-stream
    Then its error event carries the SerializedHandledError, not a plain string
    And the client applies the same handled/unknown logic as for a tRPC error

  # ==========================================================================
  # Client presentation is decided in one place, keyed on code
  # ==========================================================================

  @bdd @domain-errors
  Scenario: The client renders a handled error usefully and an unknown one generically
    Given a client receives a handled error of a known code
    Then a code-keyed explainer maps it to user-facing copy and an optional action
    And when the error has no domain payload
    Then the client shows a single generic "something went wrong" plus a trace id

  @bdd @domain-errors
  Scenario: code is the discriminant across process and serialisation boundaries
    Given a serialised handled error crosses a worker or process boundary
    Then consumers branch on `error.code`, not `instanceof`
    And identity survives the boundary intact

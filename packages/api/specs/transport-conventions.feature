# See dev/docs/ARCHITECTURE.md §8 (the 2026-09-23 lines).
Feature: The REST runtime renders what a transport may not hand-roll
  A handler never sets a header to refuse and never reads its own body. The runtime reads an
  absent body as the empty object and renders a handled refusal's wait as Retry-After, so a
  transport declares an empty input or throws a HandledError and the wire keeps working.

  Rule: An absent body is read as the empty object

    @integration
    Scenario: A bodiless call to an action that takes no body reads the empty object
      Given a route whose input schema accepts the empty object
      When it is called with no body attached, a declared length of zero, or a stream that ends empty
      Then the handler is handed the empty object, whatever the body-carrying method

    @integration
    Scenario: A bodiless call to an action that needs fields is refused as a validation error
      Given a route whose input schema requires a field
      When it is called with a JSON content type and no body
      Then it is refused with the same validation error a call with no content type receives
      And the handler is not reached

    @integration
    Scenario: A body that was sent is parsed as sent, never read as the empty object
      Given a route whose input schema accepts the empty object
      When the body is an explicit null, an empty JSON string, malformed JSON or whitespace
      Then it is refused, and the handler is not reached
      And a body carrying fields hands the handler those fields

  Rule: A body that does not parse is the caller's mistake, never ours

    @integration
    Scenario: Malformed JSON under a JSON content type is refused as a handled 400
      Given a route that declares a JSON input
      When it is called with a JSON content type and a body that is not JSON
      Then it is refused with 400 and the code malformed_request, never a 500
      And the handler is not reached

  Rule: A protocol route renders every refusal in its protocol's own document

    @integration
    Scenario: A refusal raised at the door answers in the protocol's document
      Given a protocol route that declares how its protocol renders a refusal
      When its door refuses the caller
      Then the answer is the protocol's document at the door's status, not the canonical envelope

    @integration
    Scenario: A refusal raised while parsing the request answers in the protocol's document
      Given a protocol route that declares how its protocol renders a refusal
      When the body is malformed JSON or does not match the declared input
      Then the answer is the protocol's document at the parser's status, not the canonical envelope

    @integration
    Scenario: A refusal the handler throws answers in the protocol's document
      Given a protocol route that declares how its protocol renders a refusal
      When its handler throws a handled refusal, or fails with an unhandled error
      Then the answer is the protocol's document the renderer wrote for that failure

    @integration
    Scenario: A route that declares no refusal renderer keeps the family's boundary
      Given a family mounting a protocol route with a renderer beside routes without one
      When a route without one refuses
      Then it answers the family's canonical envelope exactly as before

    @integration
    Scenario: A protocol answer with no content names no media type
      Given a protocol route whose handler writes a 204 with no body
      When it answers
      Then the answer carries no Content-Type

  Rule: A handled refusal's wait is rendered as Retry-After

    @integration
    Scenario: A handled refusal naming its wait is answered with Retry-After in whole seconds
      Given a handler that throws a HandledError whose meta names retryAfterMs
      When the refusal is rendered
      Then the answer carries Retry-After as that wait rounded up to whole seconds

    @integration
    Scenario: A refusal naming no usable wait carries no Retry-After
      Given a handled refusal whose meta names no wait, a wait as text, a negative wait or null
      When the refusal is rendered
      Then the answer carries no Retry-After

    @integration
    Scenario: Retry-After leaves the refusal's status, body and an existing Retry-After as they were
      Given a handled refusal that names its wait
      When the refusal is rendered
      Then its status and its body are exactly what the family's boundary renders
      And a Retry-After the boundary or the rate limiter already set is kept

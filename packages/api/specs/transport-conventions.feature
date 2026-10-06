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

    @integration
    Scenario: An input intersecting an object with a union of objects is validated by the runtime
      Given a route whose JSON input is an object intersected with a discriminated union of objects
      When it is called with a body matching both sides
      Then the handler is handed the fields of both sides
      And malformed JSON is refused with 400 malformed_request and a body missing a side with 422 validation_error

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
    Scenario: A protocol refusal that declines a failure leaves it to the family's boundary
      Given a protocol route whose refusal renders only the failures its protocol has a document for
      When the door refuses the caller with a failure the refusal declines
      Then it answers exactly what a route with no refusal renderer answers
      And a failure the refusal does not decline still answers in the protocol's document

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

  Rule: A request is authenticated before its body is read (ARCHITECTURE.md §8, Alex, 2026-09-30)

    @integration
    Scenario: A refused credential is answered before the body is validated
      Given a route whose body, form or path fails its schema, or exceeds its cap
      When the caller presents no credential or an invalid one
      Then it is refused with 401, never 422 or 413, and the handler is not reached
      And an authenticated caller sending the same request is refused with 422 or 413

    @integration
    Scenario: A signed door verifies the raw body before anything is parsed
      Given a route whose door verifies a signature over the raw body
      When the signature does not match
      Then it is refused with 401 before its path or body is validated
      And a matching signature hands the handler the exact bytes that were verified

    @integration
    Scenario: A public route's credential fact refuses before the body is validated
      Given a public route whose fact reads the credential alone and refuses with a hidden 404
      When a caller it refuses sends a body that fails its schema
      Then it is refused with 404, never 422, and the handler is not reached
      And a caller it admits is refused with 422 for the same body, and reaches the handler with a valid one

    @integration
    Scenario: A fact that reads the parsed input resolves after the body is validated
      Given a route whose fact is declared to read the parsed input
      When a caller sends a valid body
      Then the fact sees the validated body
      And a body that fails its schema is refused with 422 before the fact resolves

    @integration
    Scenario: The project a route acts on is still resolved from its parsed input
      Given a route that names its project in its query
      When an authenticated caller sends it
      Then the permission is asked at the project the parsed query named

  Rule: A schema failure a service throws is the caller's fault

    @integration
    Scenario: A schema failure a service throws is a handled 422, never a 500
      Given a service that parses its input with a schema and throws the bare schema failure
      When the REST boundary renders the error
      Then it is the 422 validation error naming the failing field, and nothing is logged as a 500

  Rule: A value the store refuses is the caller's fault

    @integration
    Scenario: A value the store cannot hold is a 422, never a 500
      Given a service that writes a string holding a NUL byte and the store refuses it as a data exception
      When the REST boundary renders the error
      Then it is the 422 validation error, and a database outage stays a 500

    @integration
    Scenario: A unique constraint a service did not check is a 409, never a 500
      Given a service that writes a row whose unique key another writer took first
      When the REST boundary renders the error
      Then it is the 409 conflict

  Rule: A 5xx body is kept only when the class declares the failure the caller's

    @unit
    Scenario: A 5xx the class does not declare the caller's stays masked
      Given a HandledError declaring a platform fault at 503, a HandledError at 503 declaring no fault, or a plain thrown Error
      When the REST boundary renders it
      Then the answer is the opaque internal_error body at the error's status, with no meta

    @unit
    Scenario: A 5xx the class declares the caller's keeps its body
      Given a HandledError declaring a customer fault at 503 with meta
      When the REST boundary renders it
      Then the answer carries its own code, message and meta at 503

  Rule: A 5xx whose class declares no fault is presumed the platform's

    @unit
    Scenario: An undeclared fault at 5xx is presumed the platform's
      Given a HandledError at 503 whose class declares no fault, raised here or relayed from a herr envelope
      Then its fault is presumed_platform

    @unit
    Scenario: An undeclared fault below 5xx stays the caller's
      Given a HandledError at 422 whose class declares no fault
      Then its fault is customer

    @unit
    Scenario: A declared fault wins over the status
      Given a HandledError declaring a fault at any status
      Then its fault is the one it declared

    @unit
    Scenario: An undeclared fault at 5xx is logged and reported as the platform's
      Given a HandledError with a presumed_platform fault
      When a request or call fails with it
      Then the failure is logged at error level with handledErrorFault presumed_platform

    @unit
    Scenario: A presumed platform fault goes on the wire as itself
      Given a HandledError with a presumed_platform fault
      When it is serialized for a client over tRPC or REST
      Then the fault reads presumed_platform and the REST error schema accepts it

  Rule: Running out of database connections is a retryable wait, not a fault

    @integration
    Scenario: A database with no connection to give is a retryable 503, never a 500
      Given a service whose store could not get a Postgres connection or start a transaction in time
      When the REST boundary renders the error
      Then it is the 503, marked retryable
      And the answer carries Retry-After

    @integration
    Scenario: A family's own error handler cannot turn a busy database back into a 500
      Given a family whose own error handler answers anything unhandled as a 500
      When its service's store could not get a Postgres connection in time
      Then the family's handler is handed the handled 503, and the answer is a 503 with Retry-After

  Rule: A raw body is read only under the media type its route declared (Alex, 2026-10-05, E9)

    @integration
    Scenario: A raw body sent under another media type is refused with 415 before the handler
      Given a route that reads its raw body and declares the media type it reads
      When it is called with a body under another media type, or with no Content-Type at all
      Then it is refused with 415 and the code unsupported_media_type, and the handler is not reached
      And a body under the declared type, with parameters or in another letter case, reaches the handler as sent

    @integration
    Scenario: A route that keeps main's 400 declares it, and its protocol renders it
      Given a route that declares an unmatched media type a malformed request, as the legacy family and the collector do
      When it is called with a body under another media type
      Then it is refused with 400 and the code malformed_request, and the handler is not reached
      And a protocol route that declares its own refusal document renders that 400 in it

    @integration
    Scenario: A route that read any media type on main declares it accepted and still documents its own
      Given a route that declares its media type accepted, as main's routes that never asked the Content-Type do
      When it is called with a JSON body under text/plain, or with no Content-Type at all
      Then the handler is handed the body as sent
      And its OpenAPI document still publishes the body under the media type it declared

    @integration
    Scenario: A refused credential is answered before the media type is checked
      Given a raw-body route behind a credential door that declares its media type
      When a caller presents no credential and a body under another media type
      Then it is refused with 401, never 415 or 400, and the handler is not reached

    @integration
    Scenario: A raw body route that names no media type of its own is not checked
      Given a raw-body route that names no media type, so publishes its form's default
      When it is called with a body under any media type
      Then the handler is handed the body as sent
      And a route that declares a refusal for a media type it never named, or names a media type with parameters or a wildcard, refuses to build

  Rule: A JSON body may be an array, handed under the field its route names (Alex, 2026-10-05, E1)

    @integration
    Scenario: An array body is validated as sent and handed under the field its route names
      Given a route whose JSON input is an array of objects, declared to be handed under one field
      When it is called with an array whose items match
      Then the handler is handed the array under that field, beside the route's path and query fields
      And malformed JSON and an absent body are refused with 400 malformed_request, before the handler
      And an item the schema refuses is refused with 422 validation_error, before the handler
      And the document publishes the array itself as the required request body

    @unit
    Scenario: An array body's field is checked against the route's other fields where it is written
      Given a route that declares an array body
      When it names no field, or a field its path or query already declares
      Then the declaration is refused where it is written, naming the route or the field

# See dev/docs/plans/rest-declaration-api-v2.md §3.5 and dev/docs/ARCHITECTURE.md §8.
Feature: Declared response kinds
  A route that answers with JSON returns a plain value and the framework serialises it.
  A route that answers any other way says which kind of answer it gives, and is handed
  the one producer that makes that kind. There is no second way to write bytes: a
  hand-built Response, or another kind's answer, is refused where it is written.

  @integration
  Scenario: A route that declares bytes answers with the bytes it produced
    Given a route declaring the bytes kind and the media types it publishes
    When its handler produces a buffer with a media type and a filename
    Then the answer carries those bytes, their length and a quoted disposition

  @integration
  Scenario: A streamed answer is dropped for the HEAD twin
    Given a route declaring the bytes kind that answers GET and HEAD
    When a HEAD request is answered
    Then the body is dropped and the stream it would have written is cancelled

  @integration
  Scenario: Bytes held in a store that can sign for them redirect the caller
    Given a route declaring the bytes kind whose store signs a URL
    When its handler says where the bytes are stored
    Then the caller is redirected there with the signature's own lifetime

  @integration
  Scenario: An event stream is framed by the framework, never by the handler
    Given a route declaring the event-stream kind
    When its handler produces two events, one of them carrying two lines
    Then the wire carries the event-stream media type and both events framed
    And a caller that hangs up ends the handler's own stream

  @integration
  Scenario: A wire we do not own is written exactly as the handler wrote it
    Given a route declaring the protocol kind with the reason it is needed
    When its handler writes a status, a media type and a body
    Then the answer carries all three unchanged

  @integration
  Scenario: A forwarding route answers with the response it was handed
    Given a route declaring the forwarded kind on every method
    When its handler passes an upstream response through
    Then the caller receives that response verbatim
    And a request it recognises nothing of is declined to whatever is mounted after

  @integration
  Scenario: An answer no producer made is refused
    Given a route declaring a kind whose handler returns a hand-built answer
    When the request is answered
    Then the framework refuses it, naming the route

  @unit
  Scenario: The two kinds that write a foreign wire must say why
    Given a route declaring the protocol kind with a blank reason
    When the declaration is read
    Then it is refused where it is written, naming the kind

  @unit
  Scenario: A route answers one way
    Given a route that declares an output schema
    When it also declares a response kind
    Then the declaration is refused as answering twice

  @unit
  Scenario: A declared kind publishes its media types in the document
    Given a route declaring the bytes kind and the media types it publishes
    When the document is generated
    Then the answer publishes those media types and no schema

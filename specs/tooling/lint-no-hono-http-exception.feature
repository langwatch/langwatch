Feature: The no-hono-http-exception lint rule
  A module answers with a HandledError. A hand-built `HTTPException` from
  `hono/http-exception` skips the framework's error mapping; an oversized body
  is refused by `.withBodyLimit`'s `PayloadTooLargeError` with code
  `payload_too_large`. The framework itself may still import it.

  @unit
  Scenario: A module importing hono/http-exception is reported
    Given a module transport that imports HTTPException from hono/http-exception
    When the no-hono-http-exception rule runs over it
    Then it reports honoException

  @unit
  Scenario: A module importing hono without its exception is accepted
    Given a module transport that imports a type from hono
    When the no-hono-http-exception rule runs over it
    Then it reports nothing

  @unit
  Scenario: The framework importing hono/http-exception is not this rule's business
    Given a framework package file that imports HTTPException from hono/http-exception
    When the no-hono-http-exception rule runs over it
    Then it reports nothing

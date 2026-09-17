Feature: The rest-handler-throws lint rule
  A REST route handler returns the plain result its declared output
  describes, or throws - a HandledError for a named failure, a plain Error
  otherwise. It never builds its own answer with `jsonAnswer`, `c.json`,
  `new Response` or a manually constructed `HTTPException`. The same
  `publicRoute`/`withRawResponse` escape applies: a raw answer's own type is
  a real `Response`.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A handler that returns plainly and throws is compliant
    Given a route handler that throws a named error and otherwise returns its plain result
    When the rest-handler-throws rule runs over it
    Then it reports nothing

  @unit
  Scenario: A handler calling jsonAnswer is reported
    Given a route handler that calls jsonAnswer with an error body and a status
    When the rest-handler-throws rule runs over it
    Then it reports manualAnswer
    And the message names jsonAnswer

  @unit
  Scenario: A handler calling c.json is reported
    Given a route handler that calls c.json with an error body and a status
    When the rest-handler-throws rule runs over it
    Then it reports manualAnswer
    And the message names c.json

  @unit
  Scenario: A handler constructing a raw Response is reported
    Given a route handler that constructs a new Response with an error status
    When the rest-handler-throws rule runs over it
    Then it reports manualAnswer
    And the message names new Response

  @unit
  Scenario: A handler constructing an HTTPException is reported
    Given a route handler that throws a manually constructed HTTPException
    When the rest-handler-throws rule runs over it
    Then it reports manualAnswer
    And the message names new HTTPException

  @unit
  Scenario: A manual answer nested inside the handler is still reported
    Given a route handler whose nested closure calls jsonAnswer
    When the rest-handler-throws rule runs over it
    Then it reports manualAnswer

  @unit
  Scenario: A withRawResponse handler answering with its own Response is not this rule's business
    Given a route declaring withRawResponse whose handler returns a new Response
    When the rest-handler-throws rule runs over it
    Then it reports nothing

  @unit
  Scenario: A publicRoute handler answering with c.json is not this rule's business
    Given a route declaring withAccess(publicRoute(...)) whose handler calls c.json
    When the rest-handler-throws rule runs over it
    Then it reports nothing

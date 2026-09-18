Feature: The rest-declares-its-answer lint rule

  Not yet enabled in oxlint.architecture.jsonc: the tree carries roughly 124
  pre-existing findings the migration sweep onto packages/api's declared
  response-kind seam (.withResponse) has not cleared yet, and the current
  lint-rule policy carries no baseline tier to defer them to. This spec and
  its bound tests exist so the rule is ready the moment the sweep finishes.

  A REST route declares the kind of answer it gives - JSON (the default), or
  an explicit `.withResponse("bytes" | "sse" | "redirect" | "protocol" |
  "forwarded")` - and the handler produces only that kind. It never builds a
  `Response` by hand, writes JSON through `c.json` without declaring a kind,
  returns a raw `{ status, headers, body }` literal without declaring a kind,
  reaches for the retired `.withRawResponse` hatch, or imports the framework's
  own envelope helpers from outside the framework.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A route producing its declared kind through the response argument is compliant
    Given a route declaring withResponse("bytes", ...) whose handler returns response.bytes(...)
    When the rest-declares-its-answer rule runs over it
    Then it reports nothing

  @unit
  Scenario: A handler constructing a raw Response is reported as manualResponse
    Given a route handler that constructs a new Response
    When the rest-declares-its-answer rule runs over it
    Then it reports manualResponse

  @unit
  Scenario: A handler constructing a raw Response is reported even when a kind is declared
    Given a route declaring withResponse("bytes", ...) whose handler still constructs a new Response
    When the rest-declares-its-answer rule runs over it
    Then it reports manualResponse

  @unit
  Scenario: A handler calling c.json without a declared kind is reported as undeclaredAnswer
    Given a route with no withResponse whose handler calls c.json
    When the rest-declares-its-answer rule runs over it
    Then it reports undeclaredAnswer

  @unit
  Scenario: A handler returning a raw status/headers/body literal without a declared kind is reported as undeclaredAnswer
    Given a route with no withResponse whose handler returns a { status, headers, body } literal
    When the rest-declares-its-answer rule runs over it
    Then it reports undeclaredAnswer

  @unit
  Scenario: A withRawResponse route is reported as rawResponseHatch
    Given a route declaring withRawResponse
    When the rest-declares-its-answer rule runs over it
    Then it reports rawResponseHatch

  @unit
  Scenario: Importing jsonResponse or rateLimitedResponse from @langwatch/api/rest is reported as canonicalEnvelope
    Given a source file importing jsonResponse or rateLimitedResponse from @langwatch/api/rest
    When the rest-declares-its-answer rule runs over it
    Then it reports canonicalEnvelope

  @unit
  Scenario: The REST framework's own response-writing source is not this rule's business
    Given a file under packages/api/src/rest or the canonical error boundary that constructs a new Response
    When the rest-declares-its-answer rule runs over it
    Then it reports nothing

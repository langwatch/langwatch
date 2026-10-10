Feature: The rest-route lint rule
  One rule for a REST route (dev/docs/ARCHITECTURE.md §8): every route declares
  its input and its answer, answers by returning a plain value or throwing,
  names its path parameters for what they identify (a route main already
  publishes keeps the names it published) and takes its wire schemas
  from its own module's contract. Each defect is reported once, where it is
  written - the route's method, the offending call or node - and names the
  route by method and path.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A fully declared JSON route is compliant
    Given a POST route declaring withInput, withPermission and withOutput
    When the rest-route rule runs over it
    Then it reports nothing

  @unit
  Scenario: A route with no declared answer is reported at its method
    Given a GET route declaring withParams and withPermission and no answer
    When the rest-route rule runs over it
    Then it reports missingOutput on the route's method
    And the message names the route's method and path

  @unit
  Scenario: Each route of one router is reported on its own line
    Given a router declaring two routes that each lack an answer
    When the rest-route rule runs over it
    Then each missingOutput is reported on its own route's method, never on the router head

  @unit
  Scenario: A handler passed by reference is judged by the declaration alone
    Given a declared route whose handler is a named function
    When the rest-route rule runs over it
    Then it reports nothing

  @unit
  Scenario: responds() and withResponse() count as a declared answer
    Given a route declaring responds() and a route declaring withResponse("bytes")
    When the rest-route rule runs over them
    Then it reports nothing

  @unit
  Scenario: A publicRoute is exempt from the declared input and answer
    Given a route declaring withAccess(publicRoute(...)) directly or through a const, and no answer
    When the rest-route rule runs over it
    Then it reports nothing

  @unit
  Scenario: A body-carrying route missing its input is reported at its method
    Given a POST route declaring withOutput but no withInput
    When the rest-route rule runs over it
    Then it reports missingInput on the route's method
    And the fix asks for an input schema from the module's contract, an empty one for an action that takes no body

  @unit
  Scenario: A body declared through withRawBody satisfies the input
    Given a POST route declaring withRawBody instead of withInput
    When the rest-route rule runs over it
    Then it reports nothing

  @unit
  Scenario: withRawResponse is one finding on the call
    Given a route declaring withRawResponse whose handler builds a Response
    When the rest-route rule runs over it
    Then it reports rawResponse once, on the withRawResponse call, and nothing about its handler

  @unit
  Scenario: A handler building its own answer is reported where it builds it
    Given a declared route whose handler answers with c.json, a context under another name, Response.json, new Response, jsonAnswer, HTTPException or a refusal status object
    When the rest-route rule runs over it
    Then it reports manualAnswer on the call or object that builds the answer

  @unit
  Scenario: A refusal status bound to a const is still a hand-built answer
    Given a declared route whose handler returns `{ status: NOT_FOUND, body }` with NOT_FOUND a const 404
    When the rest-route rule runs over it
    Then it reports manualAnswer on that object

  @unit
  Scenario: A declared status answer under responds() is not a hand-built answer
    Given a route declaring responds() with a 404 answer whose handler returns `{ status: 404, body }`
    When the rest-route rule runs over it
    Then it reports nothing

  @unit
  Scenario: A bare path parameter is reported on the path
    Given a route at `/virtual-keys/:id`
    When the rest-route rule runs over it
    Then it reports pathParam on the path literal, suggesting `virtualKeyId`

  @unit
  Scenario: A route main already publishes keeps its parameter names
    Given main's published wire `docs/api-reference/openapiLangWatch.json` lists `GET /api/agents/{id}`
    And a route at `/:id` in the `agents` family, or one whose addressing and generation resolve to a listed address or its /api/v1 twin
    When the rest-route rule runs over it
    Then it reports no pathParam

  @unit
  Scenario: A new route with a bare parameter is still reported
    Given a route whose method, path or parameter name main's published wire does not list
    When the rest-route rule runs over it
    Then it reports pathParam on the path literal

  @unit
  Scenario: Every other rest-route check still fires on a published route
    Given a route main already publishes that declares no answer
    When the rest-route rule runs over it
    Then it reports missingOutput on the route's method

  @unit
  Scenario: A missing published wire document fails the run by name
    Given a workspace without `docs/api-reference/openapiLangWatch.json`
    When the rest-route rule meets a bare path parameter
    Then the run fails naming the document, and never passes the route silently

  @unit
  Scenario: A wire schema from another module's contract is reported where it is used
    Given a route whose withOutput uses a schema imported from another module's contract
    When the rest-route rule runs over it
    Then it reports foreignContract on that schema, not on the import
    And a type imported from the same contract is not reported

  @unit
  Scenario: Only REST transport files are judged
    Given a service file that calls c.json
    When the rest-route rule runs over it
    Then it reports nothing

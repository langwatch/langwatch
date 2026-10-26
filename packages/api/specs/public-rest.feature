# 2026-09-08: the builder these scenarios were bound through is deleted (dev/docs/plans/api-legacy-delete.md).
# The behaviour is still the requirement. Each scenario is @unimplemented until the new runtime
# (defineRestRouter + createRestRuntime) earns it again with a bound test; then retag and remove
# the file from LEGACY_INERT in packages/architecture-enforcer/src/check-feature-parity.ts.
# See ../adrs/004-public-rest-v1-and-date-negotiation.md
Feature: Public REST is a first-class API surface

  As an API author
  I want the public REST surface to use the same fluent, validated contract
  as the versioned compatibility surface
  So that HTTP source plumbing and version negotiation cannot drift by endpoint

  @typecheck @unimplemented
  Scenario: One schema describes one request
    Given an endpoint declared with get, post, put, patch or delete
    Then its chain offers one withInput and one withOutput
    And it does not offer withParams or withQuery
    And a handler input requires withInput in the editor
    And every endpoint requires withOutput in the editor and at startup

  @validation @unimplemented
  Scenario: The method selects the non-path input source
    Given a complete Zod 4 input object containing path and request fields
    When GET handles the endpoint
    Then request fields come from the query
    When POST, PUT, PATCH or DELETE handles the endpoint
    Then request fields come from the JSON body
    And path fields are merged before the complete input is validated once

  @validation @unimplemented
  Scenario: Output always crosses its schema boundary
    When a handler returns a value rejected by withOutput
    Then the central error middleware returns an internal error
    And a hand-built Response cannot bypass validation

  @versioning @unimplemented
  Scenario: The global and date versions are independent
    Given public REST service thing
    Then its global prefix is /api/v1/thing
    And v2 does not alias v1
    And a registered date or latest may follow the service name

  # Bound through the dated runtime and the REST host (2026-10-26): a header pins a dated family
  # by re-answering the request at its dated address, so both answer through one path.
  @versioning @integration
  Scenario: An omitted date version defaults to latest
    When neither the URL nor X-API-Version names a date version
    Then the newest endpoint registration answers
    And the response reports latest

  @versioning @integration
  Scenario: A header can pin the optional date version
    When X-API-Version names a real date and the URL omits it
    Then the latest registration on or before that date answers
    And it is byte-identical to the same endpoint selected by a dated URL

  @versioning @integration
  Scenario: URL and header disagreement fails
    When a dated URL and X-API-Version name different versions
    Then the response is 400 api_version_conflict
    And neither source silently takes precedence

  @versioning @integration
  Scenario: A URL naming latest or preview is answered there whatever the header pins
    When the URL names latest or preview and X-API-Version names a real date
    Then the registration the URL names answers
    And it is not refused as a conflict

  @versioning @integration
  Scenario: A header leaves a path the dated family does not serve to the route that does
    Given a literal or shared-path route answers beneath a dated family's base
    When X-API-Version names a real date
    Then that route answers as it does without the header
    And a dated family on the shared path answers at its own dated address

  @versioning @integration
  Scenario: Invalid and unavailable header versions differ
    When X-API-Version is neither latest nor a real calendar date
    Then the response is 400 invalid_api_version
    When it is a date before the service existed
    Then the response is 404

  @versioning @integration
  Scenario: A registration superseded at a later date keeps only its own dates
    Given a namespace registered at one date and superseded at a later one by a new family
    When a caller pins a date from the first registration up to the day before the later one
    Then the first registration answers
    When a caller pins the later date or after, or names no date
    Then the new family answers, unless it hands a request naming no date back as below

  @versioning @integration
  Scenario: A superseded registration answers an unpinned request its successor hands back
    Given a registration superseded at a later date that names the new family's refusal code
      that hands a request back
    When a caller naming no version is refused by the new family with that code
    Then the first registration answers the request at its own date, body included
    When the new family answers 405 and the first registration serves that method on that path
    Then the first registration answers it
    When the first registration does not serve that method on that path
    Then the new family's 405 stands
    When the new family refuses with any other code
    Then that refusal stands
    When the caller pins a version by header or by URL
    Then the new family's refusal stands, and nothing falls back
    When the first registration does not serve the path at all
    Then the new family's refusal stands

  @versioning @integration
  Scenario: A header on a family that is not dated changes nothing
    When X-API-Version names a real date on a route that is not dated
    Then the route answers exactly as without the header

  @openapi @unimplemented
  Scenario: Every supported address is documented
    Then OpenAPI contains the optional-version endpoint, each registered date
      and latest
    And the optional endpoint documents X-API-Version
    And every operation id is unique

  @compatibility @unimplemented
  Scenario: Adoption is opt-in
    Given an existing createService consumer
    Then its registrations and public URLs are unchanged
    And no public REST mount exists until createRestService is used

  # idempotency-fingerprint.ts, canonical-family-error-handler.ts, middleware-stack.ts,
  # public-rest-routing.ts, scope-accessors.ts, personal-caller.ts, pipeline.ts

  @unimplemented
  Scenario: A retry with the same key but a different body is refused
    Given a create already answered under an idempotency key
    When the same key is retried with a different body
    Then the retry is refused as a fingerprint mismatch

  @unimplemented
  Scenario: An unhandled failure answers a generic error carrying a trace id
    Given a route whose handler throws a plain error
    When a client calls it
    Then the response is a generic unknown error naming a trace id, and no internals

  @unimplemented
  Scenario: A handled failure answers its stable code, not its internal message
    Given a route that throws a handled error
    When a client calls it
    Then the response body carries that error's code

  @integration
  Scenario: A route that answers without a credential resolves none
    Given a route declared public, with the written reason it is safe to expose
    When a caller reaches it with nothing at all
    Then the door never resolves a credential
    And the handler is handed no actor and no scope
    And the published document offers the operation no security requirement

  @unit
  Scenario: A route that answers without a credential names no tenant
    Given a route declared public
    When its own declaration names a scope field, or a permission beside its public access
    Then the declaration is refused, naming what it cannot have

  @unimplemented
  Scenario: A personal caller cannot read another user's personal scope
    Given a request authenticated as one user
    When it addresses another user's personal scope
    Then the request is refused

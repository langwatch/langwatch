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

  @versioning @unimplemented
  Scenario: An omitted date version defaults to latest
    When neither the URL nor X-API-Version names a date version
    Then the newest endpoint registration answers
    And the response reports latest

  @versioning @unimplemented
  Scenario: A header can pin the optional date version
    When X-API-Version names a real date and the URL omits it
    Then the latest registration on or before that date answers
    And it is byte-identical to the same endpoint selected by a dated URL

  @versioning @unimplemented
  Scenario: URL and header disagreement fails
    When a dated URL and X-API-Version name different versions
    Then the response is 400 api_version_conflict
    And neither source silently takes precedence

  @versioning @unimplemented
  Scenario: Invalid and unavailable header versions differ
    When X-API-Version is neither latest nor a real calendar date
    Then the response is 400 invalid_api_version
    When it is a date before the service existed
    Then the response is 404

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

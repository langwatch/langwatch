# 2026-09-08: the builder these scenarios were bound through is deleted (dev/docs/plans/api-legacy-delete.md).
# The behaviour is still the requirement. Each scenario is @unimplemented until the new runtime
# (defineRestRouter + createRestRuntime) earns it again with a bound test; then retag and remove
# the file from LEGACY_INERT in packages/architecture-lint/src/check-feature-parity.ts.
# See ../adrs/003-endpoint-capabilities-are-ports.md
Feature: Endpoint capabilities — rate limiting, response caching, deprecation

  As a platform operator
  I want rate limiting, caching and deprecation declared on the endpoint and
  backed by application-supplied ports
  So that capability policy is visible in the chain and the framework never
  owns infrastructure clients

  Background:
    Given a service created with in-memory rate limiter and cache ports

  @integration
  Scenario: Rate limiting runs after the door and before the handler
    Given an endpoint declaring withRateLimit
    When an over-limit caller reaches it
    Then the answer is 429, and the handler never runs
    And the response carries Retry-After when the limiter supplies one

  @integration
  Scenario: The rate-limit key names service, endpoint, version and principal
    Given an endpoint declaring withRateLimit
    When a caller reaches it
    Then the limiter is asked about a key naming the family, the operation, the version and the principal
    And that principal is the one the door resolved, so the count is taken after it
    And the framework builds the key, so the store never decides who is being limited

  @integration
  Scenario: A cache hit serves the validated bytes without the handler
    Given an endpoint declaring withOutput and withCache
    And a previous call cached the response
    When the same call arrives again
    Then the handler does not run
    And the cached bytes are served

  @integration
  Scenario: The cache key is the complete call
    Given an endpoint with withCache
    When two calls differ only in one input field
    Then they are distinct cache entries, and each runs the handler once

  @integration
  Scenario: Tag invalidation drops a family's entries
    Given an endpoint caching under a tag of its family's own
    When the application drops that tag's entries
    Then the next call runs the handler again

  @integration
  Scenario: An endpoint without output is never cached
    Given an endpoint declaring withCache but no answer of its own
    When it is declared
    Then the declaration is refused, because unvalidated bytes may not be cached
    And a cache whose entries live no time, or carry no tag, is refused too

  @integration
  Scenario: A cache failure degrades to a handler call
    Given a cache port whose get rejects
    When a call arrives
    Then the handler runs and the caller is served
    And the failure is logged

  @integration
  Scenario: Deprecation reaches the document and the wire
    Given an endpoint declaring withDeprecated "use things.createV2"
    When the OpenAPI document is generated
    Then every dated mount of the operation is marked deprecated with the notice
    And live responses carry Deprecation and X-API-Deprecation-Notice headers
    And the first call of each deprecated route is reported once per process

  @integration
  Scenario: Deprecation headers ride errors too
    Given the same deprecated endpoint
    When a call fails validation
    Then the error response still carries the deprecation headers

  @integration
  Scenario: An endpoint declares the several answers it may give
    Given an endpoint declaring each status it answers with and the body that status carries
    When it answers with one of them that is not a success
    Then the caller receives that status, with the body the declaration named for it
    And the published document lists every declared status beside the success
    And the request is recorded as handled rather than as a server fault

  @unit
  Scenario: An endpoint that declares several answers may not also declare one
    Given an endpoint declaring the statuses it answers with
    When it also declares a single output, or a fixed success status
    Then the declaration is refused
    And a map with no success status, or with more than two, is refused too
    And a handler answering a status the map never named fails rather than reaching the caller

  @unit @integration
  Scenario: An endpoint answers 201 when it created what it returned and 200 when it replaced it
    Given an upsert whose status says only whether the record was created
    When it declares both successes carrying the one body
    Then each is served with that body, and the document lists both
    And two successes carrying different bodies are refused, because they are two answers

  @integration
  Scenario: A request carries files beside its fields
    Given an endpoint declares the fields it parses and the file parts it takes
    When a caller sends a multipart request
    Then the fields reach the handler as its input, and the files beside it
    And a request missing a file part the endpoint requires is refused, naming that part
    And the published document describes the body as multipart, with each file as binary
    And a route declaring a multipart body beside a JSON or raw one refuses to build

  @unimplemented
  Scenario: A service-level default applies until re-declared or opted out
    Given withRateLimit on the service builder
    When one endpoint re-declares it and another declares withoutRateLimit
    Then the default applies to the remaining endpoints only

  @unimplemented
  Scenario: A converted family keeps the error body its integrators parse
    Given a family declares the error envelope it publishes
    When one of its routes fails
    Then the body is that envelope's shape, not the framework's default

  @unimplemented
  Scenario: A family layers its own error handler over the envelope
    Given a family installs an error handler of its own
    When it is built
    Then it is handed the envelope's boundary handler to delegate to
    And a refusal the boundary can render still reaches it

  @unimplemented
  Scenario: A create declared replayable answers a retry from its receipt
    Given a create declares itself replayable under a caller-chosen key
    When the same key is sent twice in one tenancy
    Then the create runs once and the retry is answered from the stored bytes, marked as a replay
    And the same key in another tenancy runs the create again
    And a request carrying no key behaves exactly as it did before, writing no receipt
    And a key too short to be plausibly unique is refused rather than ignored

  @unimplemented
  Scenario: A replay answers the bytes the first response sent, not the handler's own value
    Given a replayable create whose output schema orders its keys differently from its handler
    When the same key is sent twice in one tenancy
    Then the retry's body is byte-for-byte the first response's body
    # The receipt holds the bytes the route wrote, not the value behind them.
    # Storing the handler's own object let the schema re-order the keys on the
    # way out, so a replay answered the same values as different bytes — which
    # is exactly what a caller comparing responses, or verifying a signature
    # over one, is entitled to rely on.

  @unimplemented
  Scenario: A replayable create re-checks the authorization a replay would otherwise skip
    Given a replayable create declares a read-only pre-flight check
    When a retry is answered from the stored bytes
    Then the pre-flight ran again, because a replay must not trust a grant the caller has since lost

  @integration
  Scenario: A capability declared without its port fails the build
    Given an endpoint declares a capability the process has no port for
    When the family is built
    Then it refuses, naming the port to pass

  @integration
  Scenario: A handler is given the exact request bytes
    Given an endpoint declares that its body must not be parsed
    When a request arrives
    Then the handler is given the bytes exactly as they were sent, read once
    And it is given them as text when text is what it asked for, beside its validated path input
    And the declared body cap still refuses an oversized body before the handler runs
    And the published document names the media type the endpoint said it reads, with no schema
    And a route that declares both a raw body and a parsed one refuses to build

  @integration
  Scenario: An endpoint answers outside the JSON contract when it declares what it produces
    Given an endpoint declares the media types it writes for itself
    When it returns its own status, headers and body, or a whole response it is forwarding
    Then the answer is written verbatim, with nothing validated on the way out
    And the published document lists those media types with no schema beside them
    And declaring both a schema and a raw answer, or a raw answer naming no media type, refuses to build

  @unimplemented
  Scenario: An endpoint declares the headers every answer carries
    Given an endpoint declares response headers
    When it answers
    Then they are set beside the framework's own

  @integration
  Scenario: One path answers every method when that is the surface
    Given a path is registered for every method
    When requests of different methods arrive
    Then the same handler answers each of them
    And the path publishes no operation, because it has none to publish
    And the route registry records the path once, for every method
    And an any-method route declaring a body, or naming no media type it writes, refuses to build

  @integration
  Scenario: An any-method route declines a request that is not its own
    Given an any-method route answers only the paths it recognises
    When a request it does not recognise arrives
    Then it declines and the namespace mounted after it answers as it always did
    And a route matched by method and path that declines fails, because it matched

  @integration
  Scenario: A reader answers HEAD with the headers its GET would carry and no body
    Given an endpoint declares that it answers both GET and HEAD
    When a caller sends HEAD
    Then the answer carries the headers the GET answer would have carried, and no body
    And the body the handler opened is closed rather than left for a collector
    And the published document lists the endpoint under both methods
    And declaring a body beside a method that carries none refuses to build

  @unit
  Scenario: A family publishing its paths literally may answer at the root
    Given a family that publishes its paths literally declares that it answers at the root
    When one of its paths is a single segment outside the API namespace
    Then the declaration is accepted, because that path is the whole address it answers at
    And the same path from a literal family that declared no root is refused
    And a family answering at the root that does not disclaim the /api/v1 twin is refused
    And a family that hangs its routes off a namespace may not declare a root at all

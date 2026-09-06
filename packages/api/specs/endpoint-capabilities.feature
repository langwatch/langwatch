# See ../adrs/003-endpoint-capabilities-are-ports.md
Feature: Endpoint capabilities — rate limiting, response caching, deprecation

  As a platform operator
  I want rate limiting, caching and deprecation declared on the endpoint and
  backed by application-supplied ports
  So that capability policy is visible in the chain and the framework never
  owns infrastructure clients

  Background:
    Given a service created with in-memory rate limiter and cache ports

  @unit
  Scenario: Rate limiting runs after auth and before validation
    Given an endpoint declaring withRateLimit
    When an over-limit caller posts a body that would fail validation
    Then the answer is 429, not 422
    And the response carries Retry-After when the limiter supplies one

  @unit
  Scenario: The rate-limit key names service, endpoint, version and principal
    Given two endpoints with withRateLimit on the same service
    When both are called by the same principal
    Then the limiter sees distinct keys per endpoint
    And the keys differ across version namespaces

  @unit
  Scenario: A cache hit serves the validated bytes without the handler
    Given an endpoint declaring withOutput and withCache
    And a previous call cached the response
    When the same call arrives again
    Then the handler does not run
    And the cached bytes are served

  @unit
  Scenario: The cache key is the complete call
    Given a POST endpoint with withCache
    When two calls differ only in one input field
    Then they are distinct cache entries
    And the same call under a different version namespace is distinct too

  @unit
  Scenario: Tag invalidation drops a family's entries
    Given endpoints caching under the tag "things"
    When the application invalidates "things"
    Then the next call runs the handler again

  @unit
  Scenario: An endpoint without output is never cached
    Given an endpoint declaring withCache but no output
    When the service is built
    Then the build fails, because unvalidated bytes may not be cached

  @unit
  Scenario: A cache failure degrades to a handler call
    Given a cache port whose get rejects
    When a call arrives
    Then the handler runs and the caller is served
    And the failure is logged

  @unit
  Scenario: Deprecation reaches the document and the wire
    Given an endpoint declaring withDeprecated "use things.createV2"
    When the OpenAPI document is generated
    Then every dated mount of the operation is marked deprecated with the notice
    And live responses carry Deprecation and X-API-Deprecation-Notice headers

  @unit
  Scenario: Deprecation headers ride errors too
    Given the same deprecated endpoint
    When a call fails validation
    Then the error response still carries the deprecation headers

  @unit
  Scenario: A service-level default applies until re-declared or opted out
    Given withRateLimit on the service builder
    When one endpoint re-declares it and another declares withoutRateLimit
    Then the default applies to the remaining endpoints only

  @unit
  Scenario: A converted family keeps the error body its integrators parse
    Given a family declares the error envelope it publishes
    When one of its routes fails
    Then the body is that envelope's shape, not the framework's default

  @unit
  Scenario: A family layers its own error handler over the envelope
    Given a family installs an error handler of its own
    When it is built
    Then it is handed the envelope's boundary handler to delegate to
    And a refusal the boundary can render still reaches it

  @unit
  Scenario: A create declared replayable answers a retry from its receipt
    Given a create declares itself replayable under a caller-chosen key
    When the same key is sent twice in one tenancy
    Then the create runs once and the retry is answered from the stored bytes, marked as a replay
    And the same key in another tenancy runs the create again
    And a request carrying no key behaves exactly as it did before, writing no receipt
    And a key too short to be plausibly unique is refused rather than ignored

  @unit
  Scenario: A replay answers the bytes the first response sent, not the handler's own value
    Given a replayable create whose output schema orders its keys differently from its handler
    When the same key is sent twice in one tenancy
    Then the retry's body is byte-for-byte the first response's body
    # The receipt holds the bytes the route wrote, not the value behind them.
    # Storing the handler's own object let the schema re-order the keys on the
    # way out, so a replay answered the same values as different bytes — which
    # is exactly what a caller comparing responses, or verifying a signature
    # over one, is entitled to rely on.

  @unit
  Scenario: A replayable create re-checks the authorization a replay would otherwise skip
    Given a replayable create declares a read-only pre-flight check
    When a retry is answered from the stored bytes
    Then the pre-flight ran again, because a replay must not trust a grant the caller has since lost

  @unit
  Scenario: A capability declared without its port fails the build
    Given an endpoint declares a capability the service has no port for
    When the family is built
    Then it refuses, naming the port to pass

  @unit
  Scenario: A handler is given the exact request bytes
    Given an endpoint declares that its body must not be parsed
    When a request arrives
    Then the handler is given the bytes exactly as they were sent, read once
    And a route that declares both a raw body and a parsed one refuses to build

  @unit
  Scenario: An endpoint answers outside the JSON contract when it declares why
    Given an endpoint declares a written reason for answering outside the JSON contract
    When it returns a string, or a whole response of its own
    Then the answer is written with the declared content type, or passed through untouched
    And declaring both a schema and a raw answer, or a raw answer with no reason, refuses to build

  @unit
  Scenario: An endpoint declares the headers every answer carries
    Given an endpoint declares response headers
    When it answers
    Then they are set beside the framework's own

  @unit
  Scenario: One path answers every method when that is the surface
    Given a path is registered for every method
    When requests of different methods arrive
    Then the same handler answers each of them
    And the path publishes no operation, because it has none to publish

  @unit
  Scenario: An any-method route declines a request that is not its own
    Given an any-method route answers only the paths it recognises
    When a request it does not recognise arrives
    Then it declines and the namespace mounted after it answers as it always did

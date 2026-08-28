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

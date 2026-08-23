# See ../adrs/001-rpc-first-fluent-registration.md
# See ../adrs/003-endpoint-capabilities-are-ports.md
Feature: Fluent endpoint registration

  As a feature author
  I want to register an endpoint as one call — name, version, handler,
  definition chain
  So that an endpoint's whole identity is visible in one place and new
  capabilities never change the registration signature

  Background:
    Given a service created with createService

  @unit
  Scenario: An endpoint is one register call
    When the author registers "things.create" at version "2026-08-07" with a
      handler and a chain declaring input and output
    Then the endpoint serves POST /api/things/2026-08-07/things.create
    And the handler is called with the Hono context and the validated input
    And provided services are reached as typed context variables

  @unit
  Scenario: A bare endpoint declares no chain
    When the author registers "things.ping" at a version with only a handler
    Then the endpoint answers with no input validation installed
    And a bodyless POST and an empty-object POST both succeed

  @typecheck
  Scenario: The chain offers capabilities, not signatures
    Given a definition chain
    Then it offers withInput, withOutput, withParams, withQuery, withStatus,
      withDocs, withAuth, withResourceLimit, withMiddleware, withMeta,
      withRateLimit, withCache and withDeprecated
    And adding a capability never changes the register signature

  @integration
  Scenario: Documentation text reaches the published operation
    When an endpoint declares withDocs with a summary, a description, an
      operation id and tags
    Then the OpenAPI operation carries the summary as its title, the
      description, the operation id and the tags

  @unit
  Scenario: withMeta is not documentation
    When an endpoint declares withMeta with a route policy
    Then nothing from it reaches the OpenAPI document
    And it travels on the mount report for the host's policy registry

  @unit
  Scenario: REST families register with an explicit method and path
    When the author calls registerRoute with method "get", path "/:id", a
      version, a handler and a chain
    Then the endpoint serves GET on that path under the service's versioned
      namespace
    And new RPC families cannot be expressed through registerRoute's grammar

  @unit
  Scenario: Withdrawal is explicit and dated
    Given "things.get" registered at an earlier version
    When the author withdraws "things.get" at a later version
    Then versions from that date onward answer 410 Gone
    And earlier versions keep answering

  @unit
  Scenario: A service-level capability is the default for every endpoint
    Given withCache declared on the service builder
    When an endpoint declares no cache of its own
    Then the service default applies to it

  @unit
  Scenario: An endpoint re-declaration wins over the service default
    Given withCache declared on the service builder with tag "things"
    When an endpoint declares withCache with tag "special"
    Then the endpoint caches under "special"

  @unit
  Scenario: Middleware stacks service first, endpoint second
    Given service-level middleware and endpoint-level middleware
    When a request is served
    Then the service middleware runs before the endpoint middleware

  @unit
  Scenario: Cache and rate limit can be opted out per endpoint
    Given withCache and withRateLimit declared on the service builder
    When an endpoint declares withoutCache and withoutRateLimit
    Then neither applies to that endpoint

  @unit
  Scenario: A group applies its chain to everything registered through it
    Given a group "things" declaring withDocs tags and withRateLimit
    When "create" and "watch" are registered through the group
    Then both carry the group's tags and rate limit
    And their full names are "things.create" and "things.watch"

  @unit
  Scenario: Precedence runs service, group, endpoint
    Given a service default, a group default and an endpoint declaration for
      the same capability
    Then the endpoint's declaration wins
    And middleware runs service first, group second, endpoint last

  @unit
  Scenario: A group cannot weaken the name grammar
    Given a group whose name would fail the RPC grammar on its own
    When an endpoint is registered through it
    Then registration fails on the full dotted name

  @unit
  Scenario: A group carries no version
    Given a group declaring defaults
    When endpoints are registered through it
    Then each registration still names its own version explicitly

  @unit @validation
  Scenario: A declared capability without its port fails the build
    Given an endpoint declaring withRateLimit
    And the service was created without a rate limiter port
    When the service is built
    Then the build fails naming the endpoint and the missing port

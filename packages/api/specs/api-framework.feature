# See ../adrs/20260820-api-framework-boundary.md
Feature: API framework boundary and package authoring

  As a feature author
  I want to declare an API service with the framework's public API only
  So that product code cannot reach into framework internals and the
  framework cannot depend on product code

  @architecture @unit
  Scenario: The package owns the framework and nothing else
    Given the @langwatch/api package sources
    When their imports are audited
    Then they do not import the platform app, product features, enterprise
      code or Prisma
    And their runtime dependencies are the framework's declared contracts

  @architecture @typecheck
  Scenario: Consumers import only the sealed public API
    Given an application API family
    When it imports from @langwatch/api
    Then every symbol comes from the package root exports
    And no import reaches an implementation file by path

  @architecture @unit
  Scenario: The application is the composition root
    Given the application's API router
    When services are mounted
    Then each family builds its own app from its own file
    And the framework never enumerates the families

  @architecture @unit
  Scenario: Handlers use the process-composed application
    Given the host has composed one application instance
    When a feature endpoint handles a request
    Then the instance is available as context.app
    And the authenticated principal is available as context.actor()
    And the feature does not construct or resolve a service per request

  @security @unit
  Scenario: Every mounted endpoint has one explicit access policy
    Given REST, URL-addressed RPC and SSE endpoints built with the framework
    When the application composition root receives their mount reports
    Then each mount declares either a required permission or an explicitly
      public policy with a written reason
    And a missing policy fails the service build

  @security @unit
  Scenario: Disabling credential middleware does not make a route public
    Given an endpoint declaring withAuth "none"
    When it declares no public access policy
    Then the service build fails for an unclassified route

  @architecture @security
  Scenario: The authorization engine and ledger remain application-owned
    Given an endpoint that changes authorization facts
    When its handler calls the application service with the request actor
    Then @langwatch/api does not import the authz runtime, grants ledger or
      Prisma
    And the application writer owns per-organization cutover and audit
      emission

  @architecture @unit
  Scenario: tRPC remains a separate transport
    Given the application's tRPC router
    Then @langwatch/api does not mount, route or document it
    And it may still call the same application services and authorization
      engine

  @unit @validation
  Scenario: A rule that matters is enforced in the editor and at startup
    Given an authoring rule with a type-level statement
    When the same rule is exercised from a JavaScript-shaped call
    Then a startup assert rejects it with the same rule named
    And one test table drives both statements so they cannot drift

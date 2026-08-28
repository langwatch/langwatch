Feature: The auth boundary is classes over identity services
  As a LangWatch engineer
  I need the better-auth wiring, the auth routers and the auth route to be a
  boundary that calls identity services, with Prisma spelled in one tier
  So that a sign-in rule lives in one testable place, a lookup exists once,
  and a framework hook cannot decide anything about the data on its own

  # ADR-129 (dev/docs/adr/129-better-auth-is-a-boundary-over-identity-services.md):
  # ADR-115's discipline applied to the layer it left alone.
  #
  #   BOUNDARY     better-auth/ · routers/{auth,user}.ts · routes/auth.ts
  #                classes with injected services; never a client
  #   SERVICES     app-layer/identity/*.service.ts, ledgers, ceremonies
  #   REPOSITORY   repositories/**, *.repository.ts, *.adapter.ts, *-adapters.ts
  #   TIER         the only files that spell `prisma.` or a cache key scheme
  #   COMPOSITION  app-layer/identity/runtime.ts — the only file that says `new`
  #
  # Every scenario is a graph fact a test walks, like identity-packages.feature.
  # Behaviour does not change: every scenario that was green before ADR-129
  # is green after it, and the bindings below add rules, not features.

  @unit
  Scenario: better-auth never opens the database itself
    Given the sources under server/better-auth
    When they are scanned for imports
    Then none of them import the app's database client or a Prisma client for its value
    And a hook or plugin that needs a row is handed a service that finds it

  @unit
  Scenario: Prisma is spelled in the repository tier only
    Given the sources under server/better-auth and server/app-layer/identity
    When they are scanned for queries against the database client
    Then a query appears only in a repository or adapter file
    And the composition root holds the client to construct repositories but never queries with it
    And the auth routers and the auth route touch no account, session, passkey, verification or SSO row directly

  @unit
  Scenario: The identity services are composed in one file
    Given the sources under server/better-auth and server/app-layer/identity
    When every construction of a service, a Prisma repository or a ledger writer is located
    Then all of them are in app-layer/identity/runtime.ts
    And there is no satellite runtime beside it

  @unit
  Scenario: A question about the data is asked in one place
    Given the identity trees, the auth routers, the auth route and the users module
    When their sources outside the repository tier are scanned
    Then none of them spell a case-insensitive email match
    And none of them look an organization up by its legacy SSO domain
    And none of them spell the session cache's key scheme

  @unit
  Scenario: better-auth keeps no state of its own
    Given the sources under server/better-auth
    When they are scanned for module-scope mutable bindings
    Then there are none
    And a cache, a counter or a request-carried value is a field on the class that owns it

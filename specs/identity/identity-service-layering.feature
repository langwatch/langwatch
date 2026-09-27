Feature: The auth boundary is classes over identity services
  As a LangWatch engineer
  I need the better-auth wiring to be a boundary that calls identity services,
  with Prisma spelled in one tier
  So that a sign-in rule lives in one testable place, a lookup exists once,
  and a framework hook cannot decide anything about the data on its own

  # ADR-131's discipline, on today's module layout (dev/docs/ARCHITECTURE.md):
  #
  #   BOUNDARY     modules/auth/process/src/channels/http/http.better-auth*.channel.ts
  #   SERVICES     modules/identity/process/src/services/*.service.ts
  #   TIER         modules/{identity,auth}/process/src/repositories/prisma/** — the only
  #                files that name a Prisma client or match an address case-insensitively
  #   COMPOSITION  modules/identity/process/src/app/** and eventing/*.pipeline.ts
  #
  # Every scenario is a source fact a ratchet test walks. Behaviour does not
  # change: the bindings add rules, not features.

  @unit
  Scenario: better-auth never opens the database itself
    Given the better-auth channels in the auth module
    When they are scanned for imports
    Then none imports a Prisma client for its value
    And a hook that needs a row is handed a service or API that finds it

  @unit
  Scenario: Prisma is spelled in the repository tier only
    Given the identity and auth process sources
    When they are scanned for imports of a Prisma client
    Then a value import appears only under repositories/prisma

  @unit
  Scenario: The identity services are composed in one file
    Given the identity process sources
    When every construction of a service is located
    Then each one is in the module's composition: its app folder or an eventing pipeline
    And a service that still builds its own helper services is a named residual
    And the list of named residuals only shrinks

  @unit
  Scenario: A question about the data is asked in one place
    Given the identity and auth process sources outside the repository tier
    When they are scanned for query spellings
    Then none spells a case-insensitive match against the database

  @unit
  Scenario: better-auth keeps no state of its own
    Given the better-auth channels in the auth module
    When they are scanned for module-scope mutable bindings
    Then there are none
    And a cache, a counter or a request-carried value is a field on the class that owns it

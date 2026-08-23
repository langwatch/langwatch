Feature: Identity ships as two packages with one composition root
  As a LangWatch engineer
  I need the identity platform's boundaries enforced by module resolution,
  not by convention
  So that the pure core stays importable by the frontend, the server runtime
  stays free of storage engines and environment, and the app has exactly one
  place that wires them

  # ADR-115 (dev/docs/adr/115-identity-ships-as-packages.md): the authz
  # shape applied to identity.
  #
  #   @langwatch/identity          pure, isomorphic — vocabulary, facts,
  #                                reducer, errors, parity policy
  #   @langwatch/identity-server   services over ports — guards, the five
  #                                verbs, the ceremonies, the better-auth
  #                                facade; no Prisma, no env, no framework
  #   platform/app                 Prisma repositories, the ledger writer,
  #                                the gate, and ONE runtime that composes
  #                                everything
  #
  # Every scenario below is a graph fact a test walks; a leak that a folder
  # would merely frown at fails the build here.

  @unit
  Scenario: The pure identity core compiles without node types
    Given the @langwatch/identity package
    When its sources are scanned for imports
    Then none of them import a node built-in, Prisma, the app, or the event-sourcing framework

  @unit
  Scenario: The identity server runtime reads no storage engine and no environment
    Given the @langwatch/identity-server package
    When its sources are scanned for imports and environment reads
    Then none of them import Prisma, the app, or the event-sourcing framework
    And none of them read process.env

  @unit
  Scenario: The app composes the identity services in exactly one place
    Given the app's server sources
    When every construction of an IdentityService is located
    Then it is in app-layer/identity/runtime.ts and nowhere else
    And better-auth reaches identity only through that runtime

# See ../adrs/001-package-boundary.md
# Existing authorization semantics remain specified in:
# - ../../../../specs/rbac/unified-authorization-engine.feature
# - ../../../../specs/rbac/authz-grants.feature
# - ../../../../specs/migration/authz-grants-rollout.feature
# Package-placement scope is defined here; permission declaration behaviour
# remains specified by ../../../../specs/rbac/typed-permission-declarations.feature

Feature: AuthZ package boundary
  As a maintainer
  I want authorization to follow the strict feature package layout
  So that every caller uses one portable contract and runtime details stay private

  @architecture @typecheck
  Scenario: AuthZ has one versioned feature root
    Given the AuthZ feature declares layoutVersion 0
    Then @langwatch/authz-contract contains its portable vocabulary, schemas, errors and service capabilities
    And @langwatch/authz-server contains its concrete services, repositories, adapters, projections and migration
    And packages/authz and packages/authz-server do not exist
    And no compatibility package or forwarding export preserves the old package name

  @architecture @contract @typecheck
  Scenario: The contract is portable and uses Zod 4
    Given a browser or another feature imports @langwatch/authz-contract
    Then principals, scopes, permissions, decisions, commands and event payloads come from Zod 4 schemas
    And TypeScript transport types are inferred from those schemas
    And the permission registry retains its exact append-only order
    And the package imports no Node, Prisma, Redis, Eventing, Hono, tRPC server code or application source

  @architecture @contract @security
  Scenario: Authorization witnesses can only be minted by the service
    Given a caller needs an Authorized witness
    When AuthzService authorizes the request
    Then the service returns the opaque witness after an allowed decision
    And the contract exports the witness type but no witness-minting function or subpath

  @architecture @services
  Scenario: AuthZ exposes two service capabilities
    Given a runtime composes AuthZ
    Then AuthzService owns decisions, scope resolution and access reads
    And AuthzGrantsService owns grant mutations and offboarding
    And compatibility binding, resource-grant and role-definition writes remain methods on AuthzGrantsService
    And both concrete service classes expose static create
    And collector, listing, cache, gate and ledger details are not public services

  @unit @observability
  Scenario: A process with no metric registry composes AuthZ
    Given a process composes the AuthZ adapter and gives it no metrics port
    When it builds the feature
    Then it receives the AuthZ service, the grants service, the migration and the pipeline
    And nothing is dispatched and no audit row is written by the build itself

  @unit @observability
  Scenario: A process with a metric registry counts through its own port
    Given a process composes the AuthZ adapter with its own metrics port
    When it builds the feature
    Then AuthZ resolves its counters from that port rather than from a registry of its own

  @architecture @persistence
  Scenario: Persistence stays behind the server package
    Given AuthZ reads or writes authorization state
    Then its repository ports are abstract classes
    And Prisma-compatible implementations live only below repositories/prisma
    And generated Prisma types never cross a package export
    And ordinary app modules import neither an AuthZ repository nor @langwatch/authz-server

  @architecture @persistence
  Scenario: The move changes no durable model
    Given the AuthZ packages move into the feature root
    Then no authorization table is added or removed
    And every grant and role event keeps its type, aggregate identity, tenant and idempotency semantics
    And existing projection rows and migration tenant states remain readable

  @integration @eventing
  Scenario: Eventing registration is explicit
    Given no AuthZ runtime feature has been installed
    Then importing either AuthZ package registers no pipeline, projection, subscriber or migration
    When the app runtime installs AuthZ
    Then EventingAuthzAdapter exposes the existing grant command producers with consumers disabled
    And no AuthZ projection or subscriber action runs in the app process
    When the worker runtime installs AuthZ
    Then EventingAuthzAdapter registers the same grant pipeline with consumers enabled
    And AuthzGrantProjection is a class projection
    And EventingAuthzAuditAdapter supplies its class-based event subscriber action
    And replay produces the same Grant, Role and compatibility state without emitting audit actions

  @integration @eventing @idempotency
  Scenario: Audit subscriber redelivery inserts one audit record
    Given EventingAuthzAuditAdapter has inserted an audit record for a source event
    And its queue acknowledgement was lost
    When the same source event is delivered again
    Then the subscriber uses the same event-derived audit identity
    And the audit organization is the source event tenant rather than its grant or role aggregate id
    And the insert succeeds without creating or updating a second audit record

  @integration @migration
  Scenario: The existing system migration keeps its identity
    Given an organization has not completed the AuthZ grant import
    When LegacyImportAuthzGrantMigration is composed through the system migration runtime
    Then it uses the existing migration name and tenant state
    And its idempotent import and read-head cutover behaviour are unchanged
    And the worker starts automatic passes only after the AuthZ pipeline is ready
    And the app can still serve operator metadata and explicitly requested targeted passes
    And no public server migration subpath is required

  @integration @authorization
  Scenario: Permission decisions are unchanged by the package move
    Given the same principal, scope, grants, owner ceiling and migration state
    When permission is checked before and after the move
    Then the decision, denial reason, grant source and audience are identical
    And the existing authorization behaviour suites pass unchanged

  @integration @redis
  Scenario: Redis failures preserve their boundary-specific behaviour
    Given Redis is unavailable while AuthZ is running
    When migration state cannot be read
    Then the tenant is reported and uses the legacy read head
    When the epoch cache cannot be read
    Then authorization uses the authoritative uncached state
    When a revocation event is appended while its projection is delayed
    Then the synchronous deny effect still removes the permission
    And the worker projection and audit subscriber catch up after Redis recovers

  @integration @runtime
  Scenario: Each process installs only its AuthZ responsibilities
    Given the app and worker need AuthZ
    When the application preset composes the AuthZ feature
    Then only the AuthZ application composition root imports @langwatch/authz-server
    And RequestApp exposes contract-typed AuthzService and AuthzGrantsService capabilities
    And a web-only process installs command producers without running subscriber or projection consumers
    And a worker-capable process installs the same Eventing pipeline with its projection and audit subscriber consumers
    And the worker-capable process starts the automatic migration only after command senders connect
    And tRPC, middleware, API key, group, role, team, SCIM and share code receives those capabilities without constructing AuthZ infrastructure

  @integration @trpc
  Scenario: Application tRPC remains a separate adapter
    Given the application AuthZ tRPC procedures are mounted
    When a procedure resolves effective permissions or changes a grant
    Then it delegates once to the composed contract service
    And it does not construct a repository, Eventing pipeline or second AuthZ service
    And its current input, output and handled error behaviour is preserved

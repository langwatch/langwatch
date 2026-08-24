Feature: Postgres access through the Prisma driver adapter
  As an operator deploying the app against a tuned DATABASE_URL
  I want the pg driver adapter to honor the URL parameters the classic
  engine honored, and the client to construct itself only when first used
  So that an upgraded deployment keeps its schema routing and pool sizing,
  and importing server modules never drags a connection pool along

  # Background: Prisma 7 replaces the Rust engine with the node-postgres
  # driver adapter. node-postgres ignores the Prisma-style URL parameters
  # (`schema`, `connection_limit`, `pool_timeout`) the engine used to read,
  # and its own pool defaults differ (max 10 vs cpus*2+1, wait-forever vs a
  # 10s acquisition timeout). Deployments carry their tuning in DATABASE_URL,
  # so the adapter wrapper re-reads those parameters and maps them onto the
  # pg Pool config. Separately, `~/server/db` sits on half the server module
  # graph; constructing the client at import time would hand every script,
  # worker and unit suite a connection pool it never asked for.
  #
  # ADR-111 moves this behaviour into @langwatch/prisma-client. The deprecated
  # ~/server/db scenario below characterizes the current migration seam; the
  # explicit-construction scenario is the replacement contract.

  @unit
  Scenario: The schema URL parameter routes both model queries and raw SQL
    Given a DATABASE_URL carrying "?schema=langwatch_db"
    When the driver adapter is created
    Then model queries are qualified with the "langwatch_db" schema
    And the session search_path names "langwatch_db" so raw SQL resolves there

  @unit
  Scenario: Pool tuning URL parameters reach the pg pool
    Given a DATABASE_URL carrying "connection_limit=7" and "pool_timeout=20"
    When the driver adapter is created
    Then the pg pool allows at most 7 connections
    And acquiring a connection gives up after 20 seconds

  @unit
  Scenario: Absent or invalid pool parameters leave pg defaults untouched
    Given a DATABASE_URL without pool parameters, or with non-numeric ones
    When the driver adapter is created
    Then no pool overrides are passed and pg's own defaults apply

  @unit
  Scenario: A malformed DATABASE_URL defers failure to first use
    Given an empty or malformed DATABASE_URL
    When the driver adapter is created
    Then creation does not throw
    And only an actual query attempt surfaces the connection failure

  @deprecated @unit
  Scenario: Importing the db module does not construct a client
    Given a module that imports "~/server/db"
    When the module is imported
    Then no Prisma client (and no pg pool) is constructed
    When a property of the exported client is first accessed
    Then exactly one guarded client is constructed and reused thereafter

  @unimplemented @unit
  Scenario: A composition root constructs and owns the Prisma client explicitly
    Given validated PostgreSQL configuration
    When a process calls the @langwatch/prisma-client connection service
    Then one guarded Prisma client and pg pool are returned
    And no ready-made client, lazy proxy or module singleton is exported
    And the process resource scope closes the client

  # Prisma 7 removed `$use`; the tenancy guard chain re-attaches as a query
  # extension. These scenarios drive real queries through the exported client
  # against a real database, so a wiring regression (a guard silently absent
  # from the extension, or its argument rewrite dropped) fails a test rather
  # than leaking across tenants in production.

  @integration
  Scenario: A project-scoped query without a tenant filter is refused
    Given the exported client and a project-scoped model
    When a findMany names no projectId
    Then the query is refused before reaching the database

  @integration
  Scenario: An organization-scoped query without its anchor is refused
    Given the exported client and an organization-scoped model
    When a findMany names no organizationId or row id
    Then the query is refused before reaching the database

  @integration
  Scenario: A mass delete without the safe word is refused
    Given the exported client and any model
    When a deleteMany names an empty where clause
    Then the query is refused and the error names the safe word

  @integration
  Scenario: The mass-delete safe word deletes every row
    Given rows exist for a model with no tenancy column
    When a deleteMany passes the safe word as its where clause
    Then the safe word is rewritten away and every row is deleted

  @integration
  Scenario: Raw SQL without a tenancy predicate is refused, also inside a transaction
    Given the exported client
    When raw SQL naming no tenancy column runs directly or inside an interactive transaction
    Then both attempts are refused before reaching the database

  @integration
  Scenario: Raw SQL with the sanctioned tenancy marker runs
    Given the exported client
    When raw SQL carries the "-- @tenancy:" opt-out marker
    Then the query reaches the database and returns rows

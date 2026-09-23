Feature: The store-containment lint rule
  Only `repositories/<store>/**` names a store client, and a module's
  repository registry is where the clients are handed in (ARCHITECTURE.md
  §3.2, §7). One table row per store — Prisma, ClickHouse, Redis — replaces
  the three per-store containment rules. Prisma is refused even as a type;
  a ClickHouse or Redis type travels; a Redis channel speaks to its own client.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A store client value-imported outside its repository folder is reported
    Given a service that value-imports, dynamically imports or re-exports a ClickHouse or Redis client
    When the store-containment rule runs over it
    Then it reports storeClientValue on each import's line

  @unit
  Scenario: A ClickHouse or Redis type travels anywhere
    Given a service that imports only a ClickHouse or Redis type
    When the store-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: Prisma named outside repositories/prisma is reported, even as a type
    Given a service that imports a Prisma type or helper
    When the store-containment rule runs over it
    Then it reports storeNamed

  @unit
  Scenario: A repository under its store's folder names that store
    Given a repository under repositories/prisma or repositories/clickhouse importing its own store
    When the store-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A repository under another store's folder is reported
    Given a file under repositories/prisma that value-imports the Redis client
    When the store-containment rule runs over it
    Then it reports storeClientValue

  @unit
  Scenario: A Redis channel speaks to its own client
    Given a channel under channels/redis
    When it imports the Redis client, and then Prisma
    Then the Redis client passes and Prisma is reported

  @unit
  Scenario: The repository registry takes the Prisma registry helpers
    Given the module's repositories registry
    When it value-imports prismaRepositories, and then scopedPrismaClient
    Then the helper passes and the client is reported

  @unit
  Scenario: An application naming a store client is reported
    Given an application source that value-imports a Redis client
    When the store-containment rule runs over it
    Then it reports storeInApplication, and a ClickHouse type import passes

  @unit
  Scenario: A test standing a store up is not this rule's business
    Given a service unit test that value-imports a Redis client
    When the store-containment rule runs over it
    Then it reports nothing

Feature: The clickhouse-containment lint rule
  ClickHouse gets the same containment Prisma has: `@langwatch/clickhouse-client`
  is only value-importable from a `repositories/clickhouse/` repository, a
  `clickhouse.<subject>.adapter.ts` composition adapter, or the process boot
  files that construct the one connection a process holds. Everywhere else
  asks for the query through a service. Existing debt is recorded on a
  shrink-only baseline rather than fixed as part of shipping the rule.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A service value-importing the ClickHouse client is reported
    Given a service module that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports clickhouseClient

  @unit
  Scenario: A type-only ClickHouse import is allowed anywhere
    Given a service module that imports only a ClickHouse client type
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The ClickHouse repository seam is allowed
    Given a repository module under repositories/clickhouse that value-imports the client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The ClickHouse composition adapter is allowed
    Given an adapter module named clickhouse.<subject>.adapter.ts that value-imports the client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: An adapter for another store is still governed
    Given an adapter module named for a different store that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports clickhouseClient

  @unit
  Scenario: An application composition root is allowed
    Given an application composition file that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The platform infrastructure boot seam is allowed
    Given a file under an application's platform/infrastructure folder that value-imports the client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: An application config file is still governed
    Given an application config file that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports clickhouseClient

  @unit
  Scenario: A boot members file is allowed wherever it is built
    Given a file named by the members-file convention that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A shared package outside the boot seam is still governed
    Given a shared infrastructure package file that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports clickhouseClient

  @unit
  Scenario: Re-exporting a client value is reported
    Given a module that re-exports a value from the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports clickhouseClient

  @unit
  Scenario: Re-exporting a client type is allowed
    Given a module that re-exports only a type from the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A dynamic import of the client is reported
    Given a module that reaches the ClickHouse client through a dynamic import
    When the clickhouse-containment rule runs over it
    Then it reports clickhouseClient

  @unit
  Scenario: Test files keep their ClickHouse client import
    Given a test module that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A file on the debt register is left alone
    Given a file recorded on the clickhouse-containment baseline
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: An ungoverned package is left alone
    Given a file outside every package this rule recognizes
    When the clickhouse-containment rule runs over it
    Then it reports nothing

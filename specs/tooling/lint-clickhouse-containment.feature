Feature: The clickhouse-containment lint rule
  ClickHouse gets the same containment Prisma and Redis have: a ClickHouse
  client — `@langwatch/clickhouse-client` or the `@clickhouse/client` driver
  underneath it — is only value-importable from a `repositories/clickhouse/`
  repository, a `clickhouse.<subject>.adapter.ts` adapter, or the composition
  root that builds the one connection a process holds. This tree spells that
  root two ways, `*.composition.ts` in the applications and
  `*-composition.build.ts` inside a module, and both are seams. Packages whose
  whole domain is the store — the client wrapper, the shared infrastructure
  members, the test harness — are outside the rule entirely. Everywhere else
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
  Scenario: A service value-importing the ClickHouse driver is reported
    Given a service module that value-imports the ClickHouse driver directly
    When the clickhouse-containment rule runs over it
    Then it reports clickhouseClient naming the driver it reached for

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
  Scenario: A module composition build is allowed
    Given a module composition build file that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

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
  Scenario: An application config file is allowed
    Given an application config file that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: An application file outside every seam is reported
    Given an application file that is neither a seam nor config and value-imports the client
    When the clickhouse-containment rule runs over it
    Then it reports clickhouseClient

  @unit
  Scenario: A boot members file is allowed wherever it is built
    Given a file named by the members-file convention that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A package whose domain is the store is outside the rule
    Given a shared infrastructure package file that value-imports the ClickHouse client
    When the clickhouse-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The ClickHouse client package is outside the rule
    Given a file in the ClickHouse client package that value-imports the driver
    When the clickhouse-containment rule runs over it
    Then it reports nothing

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

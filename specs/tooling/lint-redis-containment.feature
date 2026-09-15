Feature: The redis-containment lint rule
  Redis gets the same containment Prisma and ClickHouse have: `ioredis` and
  `@langwatch/redis-client` are only value-importable from a
  `repositories/redis/` repository, a `redis.<subject>.adapter.ts` adapter, or
  the composition roots and boot files that construct the one connection a
  process holds. Everywhere else asks through a service, so a module keeps one
  swappable path to its data. Packages whose domain IS Redis — the client
  wrapper, the infrastructure members, the test harness and the group queue —
  are outside the rule entirely. Existing debt is recorded on a shrink-only
  baseline rather than fixed as part of shipping the rule.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A service value-importing the ioredis driver is reported
    Given a service module that value-imports the ioredis driver
    When the redis-containment rule runs over it
    Then it reports redisClient

  @unit
  Scenario: A service value-importing the redis client package is reported
    Given a service module that value-imports the redis client package
    When the redis-containment rule runs over it
    Then it reports redisClient

  @unit
  Scenario: A service value-importing a redis client subpath is reported
    Given a service module that value-imports a subpath of the redis client
    When the redis-containment rule runs over it
    Then it reports redisClient

  @unit
  Scenario: A type-only ioredis import is allowed anywhere
    Given a service module that imports only an ioredis type
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A type-only redis client import is allowed anywhere
    Given a service module that imports only a redis client type
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The redis repository seam is allowed
    Given a repository module under repositories/redis that value-imports the client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The redis composition adapter is allowed
    Given an adapter named redis.<subject>.adapter.ts that value-imports the client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: An adapter for another store is still governed
    Given an adapter named postgres.<subject>.adapter.ts that value-imports the redis client
    When the redis-containment rule runs over it
    Then it reports redisClient

  @unit
  Scenario: The dot-composition spelling of a composition root is allowed
    Given a composition root spelled *.composition.ts that value-imports the client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The dash-composition-build spelling of a composition root is allowed
    Given a composition root spelled *-composition.build.ts that value-imports the client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: An application config file is allowed
    Given an application file under platform/config that value-imports the client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: An application file outside the boot seam is still governed
    Given an application file outside config and composition that value-imports the client
    When the redis-containment rule runs over it
    Then it reports redisClient

  @unit
  Scenario: The redis client package is allowed to import its own driver
    Given a module in the redis client package that value-imports the driver
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The infrastructure package is allowed
    Given a module in the infrastructure package that value-imports the client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The test harness package is allowed
    Given a module in the test harness package that value-imports the client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: The group-queue package is allowed
    Given a module in the group queue that value-imports the driver
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: Re-exporting a client value is reported
    Given a module that re-exports a value from the redis client
    When the redis-containment rule runs over it
    Then it reports redisClient

  @unit
  Scenario: Re-exporting a client type is allowed
    Given a module that re-exports only a type from the redis client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A dynamic import of the driver is reported
    Given a module that dynamically imports the ioredis driver
    When the redis-containment rule runs over it
    Then it reports redisClient

  @unit
  Scenario: Test files keep their redis client import
    Given a test module that value-imports the redis client
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A file on the debt register is left alone
    Given a service module recorded on the redis-containment baseline
    When the redis-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: An ungoverned package is left alone
    Given a module in a package the rule does not govern that value-imports the driver
    When the redis-containment rule runs over it
    Then it reports nothing

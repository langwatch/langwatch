Feature: The prisma-containment lint rule
  Generated Prisma is only importable from a repository under
  `server/src/repositories/prisma/` or the Postgres composition adapter; a
  feature package never owns a Prisma client's connection or lifecycle.
  Standing debt is recorded on the same shrink-only baseline the ClickHouse
  and Redis containment rules read, so the three stores answer for their
  exceptions one way.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: Generated Prisma imported outside the seam is reported
    Given a service module that imports generated Prisma directly
    When the prisma-containment rule runs over it
    Then it reports generatedPrisma

  @unit
  Scenario: Generated Prisma imported from the repository seam is left alone
    Given a repository module under repositories/prisma that imports generated Prisma
    When the prisma-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A feature owning a Prisma connection is reported
    Given a service module that imports the Prisma client package directly
    When the prisma-containment rule runs over it
    Then it reports featurePrismaClient

  @unit
  Scenario: A repository claiming its own tables is left alone
    Given a repository module under repositories/prisma that imports the table-ownership helper
    When the prisma-containment rule runs over it
    Then it reports nothing

  @unit
  Scenario: A file on the debt register is left alone
    Given a file recorded on the prisma-containment baseline
    When the prisma-containment rule runs over it
    Then it reports nothing

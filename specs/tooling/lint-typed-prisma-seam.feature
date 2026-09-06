Feature: The typed-prisma-seam lint rule
  The Postgres repository seam takes a typed `PrismaClient`; it never casts a
  value `as PrismaClient`, and its `create` factory never accepts an
  untyped `database: object` parameter that would force a cast at the seam.

  @unit
  Scenario: An as PrismaClient cast at the seam is reported
    Given a Prisma repository seam file that casts a value as PrismaClient
    When the typed-prisma-seam rule runs over it
    Then it reports cast

  @unit
  Scenario: An untyped database parameter at the seam is reported
    Given a Prisma repository seam file whose create factory takes a database: object parameter
    When the typed-prisma-seam rule runs over it
    Then it reports databaseObject

  @unit
  Scenario: A correctly typed seam is left alone
    Given a Prisma repository seam file whose create factory takes a typed PrismaClient parameter
    When the typed-prisma-seam rule runs over it
    Then it reports nothing

Feature: The prisma-count-in-list-query lint rule
  Prisma builds a `_count` relation include as an uncorrelated join over the whole
  related table, and the query planner can re-run that aggregate once per row a list
  query returns — a documented production incident measured at 2.3 seconds per call on a
  192k-row table. The fix is a second `groupBy` count restricted to the listed row ids,
  run alongside the `findMany` rather than folded into it. The rule only looks inside the
  Prisma repository seam, so an unrelated object literal elsewhere that happens to carry
  a `_count` key never fires it.

  @unit
  Scenario: A count include on a findMany list query is reported
    Given a Prisma repository's findMany call whose include carries a relation _count
    When the prisma-count-in-list-query rule runs over it
    Then it reports countInsideFindMany at the _count property
    And the fix tells the author to run a second groupBy count instead

  @unit
  Scenario: A count on a single-row query is left alone
    Given a Prisma repository's findUnique call whose include carries the same relation _count
    When the prisma-count-in-list-query rule runs over it
    Then it reports nothing

  @unit
  Scenario: Count ordering is left alone
    Given a Prisma repository's findMany call that orders by a relation's _count
    When the prisma-count-in-list-query rule runs over it
    Then it reports nothing

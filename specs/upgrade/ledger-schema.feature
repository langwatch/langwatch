# Where the upgrade ledger lives (round 21, S3-BOOTSTRAP): its own Postgres schema beside the
# installation's, named `<installation schema>_upgrade_ledger`, so `public` installs keep it in
# `public_upgrade_ledger`. One ledger per installation schema, as when its tables sat in that schema.
# The runner creates it before anything else, under a transaction-scoped advisory lock; Prisma's
# schema never holds a ledger table, so Prisma neither refuses its first deploy (P3005) nor sees drift.

Feature: The upgrade ledger has its own Postgres schema
  As an operator installing or upgrading LangWatch
  I want the upgrade's own record kept apart from the application's schema
  So that the first install can record and lease before Prisma has run

  @integration
  Scenario: The ledger schema holds the widened ledger's tables and columns
    Given an empty installation schema
    When the ledger is created
    Then the ledger schema holds the run, step, target, lease and serving roster tables
    And the step has its owner and description, and the run its floor

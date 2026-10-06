# The upgrade ledger: slice S1 of dev/docs/plans/migrations-rethink-2026-10-06.md
# (sections 6.6 and 7 step 1; Alex's Q4 ruling in
# .claude/coordinator/rulings-2026-10-05.md, "Alex, 2026-10-06").
#
# The ledger is two runner-owned infrastructure tables beside _prisma_migrations
# and goose_db_version, outside the module catalogue: one row per upgrade run and
# one row per step of every kind. Nothing records which steps an installation has
# taken today beyond each tool's own table, so the first ledger is seeded from
# them: _prisma_migrations (Postgres) and goose_db_version (ClickHouse). The
# tenant summary seed from SystemMigrationTenantState waits for slice S5 (Alex,
# 2026-10-06), so its scenario stays @unimplemented until then.
#
# A seeded row is marked inferred: it was read from another tool's record, not
# observed by the runner, so a hand-patched database is visibly a guess
# (plan section 10). Releases are stamped by S2; a seeded step has none yet.
# Seeding changes no boot and takes no lock: S3 owns the entry point.

Feature: The upgrade ledger records every step an installation has taken
  As an operator upgrading LangWatch
  I want one record of every schema and data step my installation has taken
  So that an upgrade can tell what is done, what failed and what remains

  @integration
  Scenario: Creating the ledger leaves Prisma's migration history in sync
    Given a Postgres database with every Prisma migration applied
    When the ledger is created
    Then the ledger's run and step tables exist
    And Prisma reports no drift between its migration history and the database

  @integration
  Scenario: Creating the ledger twice changes nothing
    Given a Postgres database where the ledger already holds a recorded step
    When the ledger is created again
    Then the recorded step is still there, unchanged

  @integration
  Scenario: Every applied Prisma migration is seeded as a done schema step
    Given a database whose _prisma_migrations records two finished migrations
    When the ledger is seeded
    Then each migration is a postgres-schema step named "prisma:<folder name>"
    And each step is done, marked inferred, with no release yet

  @integration
  Scenario: A Prisma migration that failed and was never resolved is seeded as failed
    Given a _prisma_migrations row with neither finished_at nor rolled_back_at set
    When the ledger is seeded
    Then its step is failed, marked inferred, and carries Prisma's recorded log as its last error

  @integration
  Scenario: A Prisma migration resolved as rolled back is not seeded as done
    Given a _prisma_migrations row with rolled_back_at set and no later finished row for that migration
    When the ledger is seeded
    Then its step is pending

  @integration
  Scenario: Every applied goose version is seeded as a done ClickHouse schema step
    Given a ClickHouse goose_db_version holding the bootstrap row and two applied versions
    When the ledger is seeded
    Then each applied version is a clickhouse-schema step named "clickhouse:<zero-padded version>"
    And each step is done, marked inferred, with no release yet
    And the bootstrap version 0 is not a step

  @integration
  Scenario: A goose version migrated down is not seeded as done
    Given a goose version whose latest goose_db_version row has is_applied 0
    When the ledger is seeded
    Then its step is pending

  @integration @unimplemented
  Scenario: Each tenant migration is seeded as one summarised tenant step
    Given SystemMigrationTenantState rows for one migration with a finalized, a held and a parked tenant
    When the ledger is seeded
    Then the ledger holds one tenant step for that migration, marked inferred
    And its report counts one finalized, one held and one parked tenant
    And the per-tenant rows are left exactly as they were

  @integration
  Scenario: Seeding twice records each step once
    Given a database that has already been seeded
    When the ledger is seeded again
    Then every step appears once, with the status the second read found

  @integration
  Scenario: Seeding never overwrites a step the runner recorded itself
    Given a step the runner recorded as done, not inferred
    And the tool's own record now reads that migration as failed
    When the ledger is seeded
    Then the runner's step keeps its status and is still not marked inferred

  @integration
  Scenario: Seeding is itself recorded as a run
    When the ledger is seeded
    Then the ledger holds a seed run with its start, its finish and its outcome
    And the run counts the steps it seeded by kind

  @integration
  Scenario: A fresh database seeds an empty ledger
    Given a database on which no migration of any kind has run
    When the ledger is seeded
    Then the ledger holds no step
    And the seed run still records that it ran

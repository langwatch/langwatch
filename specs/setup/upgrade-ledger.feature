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

# The widened ledger (mig-ledger-widen; dev/docs/plans/migrations-blitz-2026-10-06.md 5.3, D2, D4,
# Q-U11). Additive only: a step gains an owner and a description, a run gains the floor it applied
# with, and three runner-owned tables arrive beside the first two: one row per ClickHouse target of
# a step, the runner's lease, and one presence row per serving process. Storage only; plans, gates
# and runs read and write these through the repository and decide for themselves.

  @integration
  Scenario: Creating the widened ledger gives the same shape as Prisma's migration
    Given a Postgres database where the S1 ledger already exists
    When the widened ledger is created by the runner, and separately by Prisma's migration
    Then both hold the owner, description, floor, target, lease and presence columns identically
    And Prisma reports no drift from its models

  @integration
  Scenario: Widening a ledger that holds a recorded step keeps the step
    Given a step the runner recorded as done before the ledger was widened
    When the widened ledger is created
    Then the step is still done and its owner and description are empty

  @integration
  Scenario: A target is stored per step and updated in place
    Given a step with a target recorded as failed with an error
    When the same target is recorded again as done
    Then the step holds exactly one row for that target, done, with no error
    And a second target of the step is listed beside it

  @integration
  Scenario: Targets are listed per step only
    Given targets recorded for two different steps
    When the targets of one step are listed
    Then only that step's targets are returned

  @integration
  Scenario: A lease held by a live owner is refused
    Given a runner holding the lease for a long time
    When another runner asks for the same lease
    Then it is refused and the first runner still holds it

  @integration
  Scenario: An expired lease is taken over
    Given a runner whose lease has expired
    When another runner asks for the same lease
    Then the other runner holds it, with its own image and host

  @integration
  Scenario: A lease is renewed and released only by its owner
    Given a runner holding the lease
    When another owner renews or releases it
    Then nothing changes
    And the holder renews it, then releases it, and the lease is free

  @integration
  Scenario: A process writes its presence and refreshes it in place
    Given a process that wrote its presence with two declared steps
    When it writes its presence again with three declared steps
    Then the ledger holds one row for the process with three steps and its original start

  @integration
  Scenario: A presence row older than the stale bound is not live
    Given one process that wrote its presence just now and one whose last write is older than the bound
    When the live presence is read
    Then only the recent process is returned

  @integration
  Scenario: Removing a process's presence deletes only its row
    Given two processes that wrote their presence
    When the presence of one of them is removed, and then removed again
    Then only the other process's row remains and the second removal is not an error

  @integration
  Scenario: Registering declared steps records them pending with owner and description
    Given two steps declared by two modules, neither in the ledger
    When the declared steps are registered
    Then each is a pending step carrying its declaring module as owner and its one-line description

  @integration
  Scenario: Registering declared steps never overwrites a done step
    Given a declared step the ledger already holds as done
    When the declared steps are registered again with a new description
    Then the step is still done, and only its owner and description are refreshed

  @integration
  Scenario: A run records the floor it applied with
    Given an upgrade run started with the LTS floor "3.20.1"
    When the runs are read
    Then the run carries the floor "3.20.1"

  @unit
  Scenario: A step declared without a description is refused
    When a declared step with an empty description is registered
    Then registering fails before anything is written

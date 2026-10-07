# The upgrade command: slice S3 (command half) of dev/docs/plans/migrations-rethink-2026-10-06.md
# (sections 6.4, 6.6, 6.7, 6.10 and 6.11) and dev/docs/plans/migrations-blitz-2026-10-06.md (section
# 5.2, row mig-s3-runner; deltas D4 and D6).
#
# `pnpm task upgrade` is the one command that changes the schema. It takes the runner lease, plans
# from the ledger and the shipped manifests, refuses an installation below the LTS floor, applies the
# plan release by release, records every step and every ClickHouse target in the ledger, runs the
# reconcilers last and records the run. Exit codes: 0 done, 1 failed, 2 refused, 3 lease not taken.
# Every integration scenario runs in its own scratch Postgres schema; the schema applier is a fake
# that records what it was asked to apply.

Feature: The upgrade command
  As an operator or a deploy pipeline
  I want one command that brings the database to the image's schema, safely and resumably
  So that no serving process ever migrates and a failure names its own cause and remedy

  Background:
    Given a scratch Postgres schema holding the upgrade ledger

  @integration
  Scenario: A second runner waits for the lease, then exits naming the holder
    Given a runner on host "pod-a" holds a live upgrade lease
    When a second runner starts with a lease deadline shorter than the holder's lease
    Then the second runner exits with code 3
    And its message names the holder "pod-a" and its image
    And the schema applier is never called by the second runner

  @integration
  Scenario: A dead holder's lease is taken over
    Given a runner on host "pod-a" held an upgrade lease that has expired
    When a second runner starts
    Then the second runner takes the lease and completes with code 0
    And the lease is released when the run ends

  @integration
  Scenario: The lease is renewed on a heartbeat while the run is in progress
    Given a run whose schema applier takes longer than the lease's lifetime
    When the run completes
    Then the lease never expired while the run held it

  @integration
  Scenario: A failed Prisma migration is named with the resolve command before anything is applied
    Given _prisma_migrations holds a row for "20261001000000_broken" that neither finished nor rolled back
    When the upgrade runs
    Then it exits with code 1 before the schema applier is called
    And its message names "20261001000000_broken"
    And its message gives the command "prisma migrate resolve --rolled-back 20261001000000_broken"

  @integration
  Scenario: A failing private ClickHouse target fails the run and is recorded per target
    Given a ClickHouse step the image declares and two targets, "shared" and "private:org_1"
    And the applier applies it on "shared" and fails on "private:org_1"
    When the upgrade runs
    Then it exits with code 1
    And the ledger records the step on "shared" as done and on "private:org_1" as failed with the error
    And the step itself is recorded failed
    And the run is recorded failed

  @integration
  Scenario: An installation below the LTS floor is refused before any schema change
    Given the ledger records a succeeded upgrade to 3.16.0 and the LTS floor is 3.20.1
    When the upgrade runs
    Then it exits with code 2
    And its message says to upgrade to 3.20.1 (LTS) first
    And the schema applier is never called

  @integration
  Scenario: A fresh install applies the schema and marks every non-schema step not-needed
    Given an empty database and manifests declaring schema, data and tenant steps
    When the upgrade runs
    Then the schema applier is called once
    And every schema step is recorded done
    And every data and tenant step is recorded not-needed
    And the run is recorded succeeded with the image's release and the LTS floor

  # The ledger has its own Postgres schema, `<installation schema>_upgrade_ledger` (round 21), so
  # it exists before Prisma's first deploy, which refuses a non-empty schema it has no record of
  # (P3005). The runner creates it first on every database, then takes the lease in it.
  @integration
  Scenario: The ledger gets its own Postgres schema first, so Prisma's first deploy runs under the lease
    Given an empty database with no _prisma_migrations table
    When the upgrade runs
    Then the ledger schema and its lease table exist before the schema applier is called
    And the schema applier runs while this runner holds the lease
    And the installation's own schema holds no ledger table when the applier starts
    And the run plans as a fresh install, marking data steps not-needed
    And the log says the ledger is ready and names its schema

  @integration
  Scenario: A ledger kept in the installation's schema is copied into the ledger schema once
    Given an earlier build left a ledger in the installation's schema with a run and a done step
    When the upgrade runs
    Then the run and the step are in the ledger schema, the step still done
    And the log names both schemas and how many steps and runs were copied
    And the old tables are left in place
    When a row is added to the old tables and the upgrade runs again
    Then nothing is copied a second time

  @integration
  Scenario: A ledger that cannot be created fails the run naming the privilege it needs
    Given the DATABASE_URL role may not create the ledger schema
    When the upgrade runs
    Then it exits 1 with schema_failed
    And the message says the role needs CREATE on the database, or the schema created beforehand
    And nothing is applied

  @unit
  Scenario: A ClickHouse database goose has not created yet reads as holding no goose history
    Given CLICKHOUSE_URL names a database that does not exist on the server
    When the upgrade reads goose's history before applying the schema
    Then the read finds no rows instead of failing
    And any other ClickHouse error still fails the read

  @integration
  Scenario: A second run is a no-op
    Given a database the upgrade has already brought to the image's release
    When the upgrade runs again
    Then it exits with code 0 without calling the schema applier
    And no step row changes

  @integration
  Scenario: Blocking code steps run after their release's schema and save their checkpoint
    Given an installation on 3.20.1 and a 3.21.0 manifest with a blocking data step
    When the upgrade runs
    Then the blocking step runs after the schema applier
    And the step is recorded done with the report it returned

  @unit
  Scenario: The upgrade task runs the code steps every installed module declares
    Given the tasks process's modules declare steps with .withMigrations
    When the upgrade command runs
    Then the runner receives every declared step as a code step and in its image steps
    And the tasks process that built them is closed afterwards

  @integration
  Scenario: A transient schema failure that left no failed migration is retried with backoff
    Given an applier that fails once without recording a failed Prisma migration, then succeeds
    When the upgrade runs
    Then it waits before the second attempt
    And it completes with code 0

  @integration
  Scenario: Reconcilers run last, and a failing one fails the run
    Given two reconcilers, the second of which fails
    When the upgrade runs
    Then both reconcilers run after every schema step
    And the run is recorded failed naming the failing reconciler

  @integration
  Scenario: Running an older image marks completed background steps pending again
    Given the ledger records a succeeded upgrade to 3.22.0 with a done background step of 3.22.0
    When the upgrade runs from a 3.21.0 image at or above the floor
    Then the 3.22.0 background step is recorded pending

  # Run phases (round 9, U2-PHASES): in the run report, a fixed shape the reader parses.
  @integration
  Scenario: A finished run's report carries its phases
    Given an empty database and a 3.21.0 image
    When the upgrade runs
    Then the run's report lists preflight, then the Postgres and ClickHouse schema phases, then reconcile
    And every phase is succeeded with a start and a finish

  @integration
  Scenario: A run whose schema fails records the failed phase and no later one
    Given the ClickHouse target fails to apply
    When the upgrade runs
    Then the run's report ends with a failed ClickHouse schema phase
    And no reconcile phase is recorded

  @integration
  Scenario: A refused upgrade is recorded as a failed run whose report names the refusal
    Given the ledger records a succeeded upgrade to 3.16.0 and the LTS floor is 3.20.1
    When the upgrade runs
    Then the run is recorded failed with the report's refused naming "below_lts_floor"
    And its only phase is a failed preflight

  # Live status (round 8, U2-LIVE): the runner raises a read hint; the api relays it.
  @integration
  Scenario: A read hint is published at each phase change and at the finish
    Given a hint publisher
    When the upgrade runs through preflight, one schema release and reconcile
    Then a hint is published as each phase starts and ends, and once when the run finishes
    And each hint names the run, the phase and its outcome under the platform upgrade scope

  @integration
  Scenario: A hint that cannot be published does not fail the run
    Given a hint publisher that refuses every publish
    When the upgrade runs
    Then the run succeeds
    And each refused publish is reported as a warning

  @unit
  Scenario: The Postgres session of a migration carries a lock timeout
    Given a database URL with and without existing session options
    When the URL for the migration session is built
    Then it sets lock_timeout and keeps every option already present

  @unit
  Scenario: upgrade status and upgrade plan print the reader's and the planner's output
    When "upgrade status" or "upgrade plan --json" is parsed
    Then the status subcommand prints the reader's status
    And the plan subcommand prints the plan as JSON when asked
    And an unknown subcommand is refused by name

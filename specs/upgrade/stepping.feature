# Stepping one release at a time: slice S4 of dev/docs/plans/migrations-rethink-2026-10-06.md
# (sections 6.4 and 6.5, and section 10's first risk) and dev/docs/plans/migrations-blitz-2026-10-06.md
# (section 5.2, row mig-s4-stepping-proof).
#
# An upgrade across several releases applies each release's schema in turn. For Postgres the
# applier writes a temporary Prisma migrations directory holding every folder up to and including
# the release, plus migration_lock.toml, and runs `prisma migrate deploy` over it; for ClickHouse it
# runs goose `up-to` the release's last version on each target. The scenarios marked "proof" pin a
# tool behaviour the design rests on, so a Prisma or goose upgrade that changes it turns them red.
# Every scenario runs in its own scratch Postgres database and ClickHouse database.

Feature: Stepping the schema one release at a time
  As the upgrade runner
  I want to apply each release's schema in turn, over exactly that release's migrations
  So that a blocking step of an older release runs against the schema it was written for

  Background:
    Given a scratch Postgres database and a scratch ClickHouse database

  @integration
  Scenario: Successive release subsets apply cleanly and record each Prisma migration once
    Given three releases whose Prisma folders sort in release order
    When each release is applied in turn
    Then each release reports Postgres applied with exactly its own new folders
    And _prisma_migrations lists every folder once, finished and not rolled back
    When the newest release is applied again
    Then Postgres reports applied with no folders

  @integration
  Scenario: A folder that sorts below an applied one is applied by the next release (proof)
    Given a release whose newest Prisma folder is applied
    When the next release adds a folder that sorts below that applied folder
    Then the next release applies the lower folder and reports success
    And _prisma_migrations lists every folder once

  @integration
  Scenario: A release directory that lacks an applied folder changes nothing (proof)
    Given three releases applied in turn
    When the first release is applied again
    Then Postgres reports applied with no folders
    And _prisma_migrations still lists all three releases' folders

  @integration
  Scenario: A failed Prisma migration fails the release and skips its ClickHouse targets
    Given a release whose Prisma folder fails to apply
    When the release is applied
    Then Postgres reports failed with Prisma's code P3018
    And every ClickHouse target reports skipped because Postgres failed
    When the next release is applied
    Then Postgres reports failed with Prisma's code P3009

  @integration
  Scenario: The newest model client cannot read or write a table an older release left behind (proof)
    Given a Prisma client generated for a schema with a column the database does not have yet
    When the client reads with its default select
    Then the read fails with Prisma's code P2022
    When the client reads with an explicit select of the existing columns
    Then the read succeeds
    When the client creates a row whose model gives the missing column a default
    Then the create fails with Prisma's code P2022 even with an explicit select

  @integration
  Scenario: goose up-to per release, then up, applies every ClickHouse version once
    Given four goose migrations shipped by three releases
    When each release is applied in turn with its last goose version
    Then each release reports the target applied with exactly its own versions
    And goose_db_version holds each version once
    When goose runs up after the last release
    Then nothing is left to apply

  @integration
  Scenario: A goose version below the applied one fails its target and names the version (proof)
    Given a ClickHouse target at version 3
    When a release adds version 2
    Then the target reports failed with the code goose_missing_migrations
    And the message names version 2

  @integration
  Scenario: A failed ClickHouse target fails the release while the other targets still apply
    Given two ClickHouse targets, one of which cannot be reached
    When the release is applied
    Then the reachable target reports applied
    And the unreachable target reports failed
    And the release reports not ok

  @integration
  Scenario: A release with no ClickHouse version yet skips goose
    Given a release whose manifests up to it carry no goose version
    When the release is applied
    Then every ClickHouse target reports skipped because there is no version to reach

  @unit
  Scenario: The release directory holds every folder up to the release and the lock file
    Given two Prisma folders up to the release
    When the release directory is written
    Then it holds both folders and a migration_lock.toml naming postgresql

  @unit
  Scenario: A release whose folder list repeats a folder is refused
    Given a folder list that names the same folder twice
    When the release is applied
    Then the applier refuses with the code duplicate_folder before running any tool

  @unit
  Scenario: A folder without migration.sql is refused
    Given a folder list naming a directory with no migration.sql
    When the release is applied
    Then the applier refuses with the code missing_migration_sql before running any tool

  @unit
  Scenario: An aborted upgrade skips every target
    Given a signal that is already aborted
    When the release is applied
    Then every target reports skipped because the upgrade was aborted

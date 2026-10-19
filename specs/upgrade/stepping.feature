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

  # `pnpm task upgrade` wires the applier: a one-release upgrade keeps the one-pass applier
  # (`prisma migrate deploy` and goose `up`); a jump whose first schema is older than the image
  # steps each release's Postgres folders through the applier above.

  @integration
  Scenario: A jump across two releases applies each release's schema, then its blocking steps, release by release
    Given an installation on the oldest of three releases
    And the two newer releases each carry a Prisma folder and a blocking data step
    When the upgrade runs with the newest image
    Then the older release's schema is applied, then its blocking step
    And then the newer release's schema, then its blocking step

  @unit
  Scenario: A one-release upgrade applies the whole schema in one pass, as before
    Given an upgrade whose first schema to apply is the image's own release
    When the schema is applied
    Then every call goes to the one-pass applier
    And nothing is said about stepping

  @unit
  Scenario: A jump across several releases steps Postgres through each release's folders in turn
    Given an upgrade whose first schema to apply is older than the image's release
    When each release's schema is applied
    Then each release is applied over every Prisma folder up to it
    And it names the last goose version up to it

  @unit
  Scenario: The unreleased steps after a stepped jump are applied in one pass
    Given a stepped jump that also has unreleased schema
    When the unreleased schema is applied
    Then it goes to the one-pass applier

  @unit
  Scenario: Each stepped release is named on the console before and after its schema
    Given a stepped jump across two releases
    When each release's schema is applied
    Then the console says the schema steps one release at a time
    And it names each release before its schema and again after it

  @unit
  Scenario: A stepped release whose schema fails is named with the failing target
    Given a stepped release whose Prisma migration fails
    When its schema is applied
    Then the console warns naming the release and the failing target
    And the failed report goes back to the runner

  @unit
  Scenario: A release with no goose version up to it steps no ClickHouse version
    Given release manifests that carry no goose version up to a release
    When the schema up to that release is worked out
    Then it names every Prisma folder up to it and no goose version

  @unit
  Scenario: A stepped release migrates ClickHouse up to its own last goose version
    Given a stepped release whose manifests up to it list goose version 2
    When its ClickHouse migrations run
    Then goose is asked to stop at version 2
    And a one-pass upgrade asks goose for no stopping version

  @unit
  Scenario: Without a stopping version goose runs exactly as before
    Given a ClickHouse migration run with no stopping version
    When the goose passes are worked out
    Then a server that needs the dimension compatibility replays up to 86 and then runs up
    And any other server runs up alone

  @unit
  Scenario: With a stopping version neither goose pass goes past it
    Given a ClickHouse migration run that stops at a version
    When the goose passes are worked out
    Then the compatibility replay stops at the lower of 86 and that version
    And the final pass runs up to that version

  @unit
  Scenario: The Prisma CLI is resolved once per process
    Given the upgrade has resolved the package's Prisma CLI once
    When a later release step runs Prisma again
    Then it reuses the first resolution instead of looking up prisma/package.json again

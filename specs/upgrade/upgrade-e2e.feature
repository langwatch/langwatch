# End-to-end upgrade and migration paths (rulings 2026-10-07, "upgrade quality bar"): the runner
# over real Postgres and ClickHouse databases, applying real migrations with `prisma migrate
# deploy` and goose. Each scenario gets its own databases and drops them after. ADR-173.
#
# The fixture releases: 3.20.1 (the LTS floor) creates a Postgres table and a ClickHouse table;
# 3.21.0 adds a column on each and declares one blocking data step.

Feature: The upgrade holds up end to end over live stores
  As an operator upgrading a LangWatch installation
  I want every upgrade path proven against real databases and real migration tools
  So that a deploy never leaves the installation half-migrated or open to its own inputs

  @integration
  Scenario: A fresh install from an empty database applies every migration, then a re-run is a no-op
    Given empty Postgres and ClickHouse databases
    When the upgrade for 3.21.0 runs
    Then every Prisma migration and every goose version is applied and recorded done
    And the blocking data step is recorded not-needed
    When the upgrade runs again
    Then it exits 0, applies nothing and changes no step row

  @integration
  Scenario: An installation at the LTS floor upgrades to the next release
    Given an installation upgraded to 3.20.1
    When the upgrade for 3.21.0 runs
    Then the 3.21.0 migrations apply on both stores and the blocking data step runs once

  @integration
  Scenario: A blocking step interrupted mid-run resumes from its checkpoint
    Given a blocking data step that saves a checkpoint and is then interrupted
    When the upgrade runs again
    Then the step starts from the checkpoint it saved and finishes

  @integration
  Scenario: Two upgraders at once - one takes the lease, the other waits and reports the holder
    When two upgrades start together on the same installation
    Then exactly one applies the migrations
    And the other logs that it waits for the lease, naming the holder, then finds nothing to do

  @integration
  Scenario: A serving process with no ClickHouse refuses by name
    Given a database URL and no ClickHouse URL or route
    When the serving gate admits an api
    Then it is refused with outcome "no-clickhouse" and the refusal names "CLICKHOUSE_URL"

  @integration
  Scenario: A lapsed roster entry stops serving and the next good write serves again
    Given an admitted worker whose roster writes then fail past the stale bound
    Then the gate reports it no longer serves
    When its roster writes succeed again
    Then the gate reports it serves again

  @integration
  Scenario: A step that throws leaves the ledger consistent and the next run names the failing step
    Given a blocking data step that throws
    When the upgrade runs
    Then the run is recorded failed, the step failed with its error, nothing left running and the lease released
    When the upgrade runs again
    Then the outcome names the failing step

  @integration
  Scenario: Hostile text in a step id or description is stored verbatim and never executed
    Given a release whose step id and description carry SQL
    When the upgrade runs
    Then the ledger stores both verbatim and every ledger table still exists

  @integration
  Scenario: No log line of a full upgrade carries the database password
    Given a database URL carrying a password
    When a fresh install runs end to end
    Then no log line carries the password

  @unimplemented
  Scenario: A tampered ledger row refuses the upgrade
    Given the ledger holds a step id no release declares, or a row whose checksum drifted
    When the upgrade runs
    Then it refuses, naming the row

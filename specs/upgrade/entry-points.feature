# Every way LangWatch starts runs `pnpm task upgrade` once, before anything serves, and the
# serving processes never migrate: they read the upgrade ledger and refuse by name when behind
# (migrations rethink 3.1 and 6.9; blitz plan 5.2 row mig-entry-points; Q5, Q10).
#
#   the image           CMD -> apps/api `start` -> the api alone; no migration
#   Helm, upgrade       the pre-roll Job runs `upgrade` on the new image before any Deployment rolls
#   Helm, first install the api's first boot finds an empty ledger on an empty schema and runs
#                       `upgrade` once; the worker refuses and restarts until it is done
#   docker compose      a one-shot `migrate` service; app and workers wait for it to succeed
#   npx server          the CLI runs `upgrade` before it starts the services
#   pnpm dev, haven     the stack's prepare step, once, before the lanes
#   dev compose         the api service runs `upgrade` before its dev command
#
# The one preparation script is apps/api's `start:prepare:db`: `upgrade` alone. The
# system-migrations pass is not part of api start (Alex, 2026-10-09).

Feature: Every entry point runs the upgrade once; serving processes never migrate
  As an operator starting or upgrading LangWatch
  I want one command to apply what the release needs, and the processes to refuse when it has not
  So that no process ever serves on a schema it was not built for, and none migrates while serving

  @unit
  Scenario: The api and the worker start without migrating
    Given the production start commands of the api and the worker
    When either starts
    Then it runs only its own process
    And neither names a migration task

  @unit
  Scenario: The one preparation script runs the upgrade and nothing else
    Given the api's preparation script
    When an entry point runs it
    Then it runs `pnpm task upgrade` and no system-migrations pass

  @unit
  Scenario: The Helm pre-roll Job runs the upgrade on the new image
    Given the chart's pre-roll Job
    When a release is upgraded
    Then the Job runs the preparation script before any Deployment rolls
    And it is never a pre-install or pre-rollback hook

  @unit
  Scenario: The compose stack runs a one-shot migrate service the app and workers wait for
    Given the self-hosted compose file
    When the stack comes up
    Then a migrate service runs the preparation script once
    And the app and the workers start only after it completed successfully

  @unit
  Scenario: The npx server runs the upgrade once before its services
    Given the npx server's migration phase
    When it prepares the databases
    Then it runs `upgrade` and then the system-migrations pass from the tasks app
    And it runs no Prisma or ClickHouse migration task of its own

  @unit
  Scenario: The local launchers run the upgrade once before the lanes
    Given the local stack launcher and the development compose file
    When a developer starts a stack
    Then the preparation runs once before any lane
    And the development api service runs the upgrade instead of its own migrations

  @integration
  Scenario: A serving process refuses by name when its installation is behind
    Given an installation whose ledger records a blocking step of this image as pending
    When the worker's gate asks
    Then it refuses, naming the step and `pnpm task upgrade`
    And it closes its ledger connection

  @integration
  Scenario: A serving process is admitted once the upgrade has run
    Given an installation whose ledger records every blocking step of this image as done
    When the api's gate asks
    Then it is admitted

  @integration
  Scenario: The gate reads the ledger in the schema DATABASE_URL names
    Given DATABASE_URL names a schema with `?schema=`, as Prisma's URLs do
    And the upgrade recorded every blocking step of this image as done in that schema
    When the api's gate asks
    Then it reads that schema's ledger and is admitted

  @integration
  Scenario: The api's first boot on an empty installation runs the upgrade once
    Given an empty ledger on an empty schema
    When the api's gate asks
    Then it runs the upgrade once and asks again
    And it is admitted when the upgrade succeeded

  @integration
  Scenario: The api refuses a first install whose upgrade failed
    Given an empty ledger on an empty schema
    When the api's gate runs the upgrade and the upgrade exits non-zero
    Then the api refuses, naming the command and the exit code

  @integration
  Scenario: The worker never runs the upgrade on a first install
    Given an empty ledger on an empty schema
    When the worker's gate asks
    Then it refuses, naming `pnpm task upgrade`, and runs nothing

  # ClickHouse is mandatory (rounds 20 and 22, S3-NO-CLICKHOUSE): an installation with a
  # database and no ClickHouse refuses by name. A memory-tier harness has no database and no
  # installation, so its gate admits without reading a ledger.
  @unit
  Scenario: A process with no ClickHouse configured refuses to serve, naming ClickHouse
    Given an installation whose Postgres steps are done
    When a gate with a database and no ClickHouse target asks
    Then it refuses, naming CLICKHOUSE_URL as required
    And no roster entry is written

  @unit
  Scenario: A process with no database configured has no installation to gate
    Given no DATABASE_URL and no CLICKHOUSE_URL
    When the gate asks
    Then it is admitted without reading a ledger

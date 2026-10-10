# No entry point runs the upgrade before serving any more: the new worker runs `pnpm task upgrade`
# under the runner's lease while the api holds (in-app-upgrade.feature; UPGRADE-IN-WORKER, UIW-1..11,
# Alex 2026-10-09; dev/docs/plans/upgrade-in-worker-2026-10-09.md).
#
#   the image           CMD -> apps/api `start` -> the api alone; it never runs a step
#   Helm, upgrade       new worker pods run the upgrade; new api pods hold, not ready until current;
#                       the pre-roll Job renders only with serializeUpgrades (UIW-4, Q11)
#   Helm, first install the worker runs the upgrade on the empty ledger; the api holds
#   docker compose      no `migrate` service; app and workers wait only for their stores
#   npx server          no migration phase; its worker half runs the upgrade
#   pnpm dev, haven     the stack's prepare step, once, before the lanes (same runner, same lease)
#   dev compose         the api service runs `upgrade` before its dev command
#
# The one preparation script is apps/api's `start:prepare:db`: `upgrade` alone. The
# system-migrations pass is not part of api start (Alex, 2026-10-09).

Feature: The worker runs the upgrade from every entry point; the api never migrates
  As an operator starting or upgrading LangWatch
  I want the new image to apply what the release needs itself, and the api to hold until it has
  So that no process ever serves on a schema it was not built for, and I never run a migrate step

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
  Scenario: A Helm upgrade without serialised upgrades renders no pre-roll Job; the new workers run the upgrade
    Given the chart with `app.storedObjects.localFilesystem.serializeUpgrades` off, or a dataplane configured
    When a release is upgraded
    Then no pre-roll Job is rendered
    And the new api pods report not ready until the ledger is current, so old pods keep serving

  @unit
  Scenario: A release without workers runs the worker as a sidecar in the app pods
    Given the chart with `workers.enabled` false
    When it renders
    Then each app pod carries the worker container, running `pnpm run start` in /app/apps/worker
    And the pod's grace period is the longer of the app's and the workers'

  @unit
  Scenario: The Helm pre-roll Job renders only when upgrades are serialised
    Given the chart with `app.storedObjects.localFilesystem.serializeUpgrades` on
    When a release is upgraded
    Then the pre-roll Job runs the preparation script before any Deployment rolls
    And it is never a pre-install or pre-rollback hook

  @unit
  Scenario: The compose stack has no migrate service; the app and workers wait only for their stores
    Given the self-hosted compose file
    When the stack comes up
    Then no service runs the preparation script
    And the app and the workers depend only on their stores

  @unit
  Scenario: The npx server starts its services with no migration phase
    Given the npx server's launcher
    When it starts
    Then it starts the api and worker halves with no migration phase of its own
    And its worker half's gate runs `upgrade` from the tasks app when the installation is behind

  @unit
  Scenario: The local launchers run the upgrade once before the lanes
    Given the local stack launcher and the development compose file
    When a developer starts a stack
    Then the preparation runs once before any lane
    And the development api service runs the upgrade instead of its own migrations

  @unimplemented
  Scenario: A serving process refused below the floor closes its ledger connection
    Given an installation whose ledger recorded a floor above this image's release
    When the worker's gate asks
    Then it refuses, naming the floor
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
  Scenario: The worker's first boot on an empty installation runs the upgrade once
    Given an empty ledger on an empty schema
    When the worker's gate asks
    Then it runs the upgrade once and asks again
    And it is admitted when the upgrade succeeded

  @unimplemented
  Scenario: A first install whose upgrade failed leaves the worker waiting for a Retry
    Given an empty ledger on an empty schema
    When the worker's gate runs the upgrade and the upgrade exits non-zero
    Then the worker names the command and the exit code and waits for a Retry
    And the api holds and offers the token console

  @integration
  Scenario: The api never runs the upgrade on a first install
    Given an empty ledger on an empty schema
    When the api's gate asks
    Then it runs nothing and holds the door

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

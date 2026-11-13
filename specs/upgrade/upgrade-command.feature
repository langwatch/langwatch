# The upgrade command: slice S3 (command half) of dev/docs/plans/migrations-rethink-2026-10-06.md
# (sections 6.4, 6.6, 6.7, 6.10 and 6.11) and dev/docs/plans/migrations-blitz-2026-10-06.md (section
# 5.2, row mig-s3-runner; deltas D4 and D6).
#
# `pnpm task upgrade` is a run-once worker (Alex, 2026-10-11): it starts the worker, which runs the
# same in-process upgrade its gate runs, and answers its exit code. The run takes the lease, plans
# from the ledger and the shipped manifests, applies the plan release by release from whatever
# release the installation is on (no required stop; Alex, 2026-10-11), records every step and every
# ClickHouse target in the ledger, runs the reconcilers last and records the run. Exit codes: 0 done,
# 1 failed, 3 lease not taken.
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
    And its message says to run it in packages/prisma-client with DATABASE_URL set
    And its message says a waiting worker runs the upgrade again by itself once the row is resolved

  # T9-F1: the command the refusal names works in the image as written.
  @unit
  Scenario: The Prisma config where the refusal sends the operator carries DATABASE_URL
    Given DATABASE_URL is set in the operator's shell
    When packages/prisma-client/prisma.config.ts loads
    Then its datasource url is DATABASE_URL, so "prisma migrate resolve" runs there

  # T9-F3: an index of another definition under a migration's index name is never accepted in
  # silence and never dropped automatically; a matching pre-built index (ops pre-build) passes.
  @integration
  Scenario: A pre-built index that differs from a pending migration's stops the upgrade by name
    Given a pending migration creates "Widget_key_key" UNIQUE on "Widget" ("key") if it does not exist
    And the database already holds an index "Widget_key_key" on "Widget" ("createdAt")
    When the upgrade runs
    Then it exits with code 1 and code "prebuilt_index_differs" before the schema applier is called
    And its message names the index, the table, the definition it should have and the one it has
    And its message says to drop or rename the index, and the index is left in place

  @integration
  Scenario: A pre-built index that matches a pending migration's passes
    Given a pending migration creates "Widget_key_key" UNIQUE on "Widget" ("key") if it does not exist
    And the database already holds the same unique index, built ahead as the ops pre-build note says
    When the upgrade runs
    Then it completes with code 0

  @unit
  Scenario: An invalid pre-built index under a migration's index name is refused
    Given a pending migration creates an index if it does not exist
    And an index of that name exists but a build that never finished left it invalid
    When the pending folders are checked
    Then the index is named as differing

  @unit
  Scenario: An index a pending migration drops before it creates it again is not compared
    Given a pending migration drops "Widget_key_key" and a later pending one creates it if it does not exist
    And the database holds an index "Widget_key_key" of another definition
    When the pending folders are checked
    Then nothing is named as differing

  # Each ClickHouse target upgrades on its own (Alex, 2026-10-11, T7-F1): a private target that
  # fails holds only its organizations; the shared target and the release go on.
  @integration
  Scenario: A failing private ClickHouse target is held while the release goes on
    Given two ClickHouse steps the image declares and two targets, "shared" and "private:org_1"
    And the applier applies them on "shared" and fails on "private:org_1"
    When the upgrade runs with retries allowed
    Then it exits with code 0
    And the ledger records both steps on "shared" as done
    And on "private:org_1" the first step failed with the error and the second pending
    And both steps themselves are recorded done, so the serving gate admits the image
    And "private:org_1" was asked once, never retried in the same run
    And the installation reads "needs attention" with one failed target

  @integration
  Scenario: A held private ClickHouse target catches up on the next pass
    Given an upgrade that held "private:org_1"
    And "private:org_1" answers again
    When the upgrade runs again with nothing else to apply
    Then it applies the image's ClickHouse steps on "private:org_1"
    And every step reads done on both targets and no target is behind
    And the installation no longer counts a failed target

  # A private target configured after the last schema release has no ledger rows, so nothing reads
  # it behind: its first run seeds it pending on every shipped ClickHouse step, then catches it up.
  @integration
  Scenario: A configured private ClickHouse target with no ledger rows is seeded as behind and catches up
    Given an upgrade that ran with "shared" as its only ClickHouse target
    And the environment now also configures "private:org_1", which has no target rows
    When the upgrade runs again with nothing else to apply
    Then its preflight records "private:org_1" pending on every shipped ClickHouse step
    And it applies the image's ClickHouse steps on "private:org_1" in the same run
    And every step reads done on both targets and no target is behind
    And a third run records nothing new and asks the applier for nothing

  @integration
  Scenario: A configured private ClickHouse target with no ledger rows that is down is held, not hidden
    Given an upgrade that ran with "shared" as its only ClickHouse target
    And the environment now also configures "private:org_1", which has no target rows and is down
    When the upgrade runs again with nothing else to apply
    Then it exits with code 0
    And on "private:org_1" the first step failed with the error and the rest pending
    And the installation reads "needs attention" with one failed target

  @integration
  Scenario: A held private ClickHouse target still down stays held and the pass succeeds
    Given an upgrade that held "private:org_1", still down
    When the upgrade runs again with nothing else to apply
    Then it asks the applier once for every shipped step and exits with code 0
    And the private target's rows stay failed

  # T7-F16: only the shared target delays ready by the full connect wait.
  @unit
  Scenario: A private ClickHouse target is waited for briefly before it is held
    Given CLICKHOUSE_MIGRATE_WAIT_SECONDS is 180
    When goose is run for the shared target and for "private:org_1"
    Then the shared target is waited for 180 seconds
    And "private:org_1" is waited for 5 seconds at most
    And a wait of 0 stays 0 on both

  @integration
  Scenario: A failing shared ClickHouse target fails the run
    Given a ClickHouse step and two targets, "shared" and "private:org_1"
    And the applier fails on "shared"
    When the upgrade runs
    Then it exits with code 1
    And the step and the run are recorded failed

  @unit
  Scenario: Every ClickHouse target failing fails the run as before
    Given only private ClickHouse targets, every one failing
    When the runner decides which targets to hold
    Then it holds none, so the failure fails the run

  @integration
  Scenario: An installation on any older release rolls through every step to the image
    Given the ledger records a succeeded upgrade to 3.16.0, older than every manifest
    When the upgrade runs from a 3.21.0 image
    Then it exits with code 0
    And the schema applier applies every shipped release up to 3.21.0

  @integration
  Scenario: A fresh install applies the schema and marks every non-schema step not-needed
    Given an empty database and manifests declaring schema, data and tenant steps
    When the upgrade runs
    Then the schema applier is called once
    And every schema step is recorded done
    And every data and tenant step is recorded not-needed
    And the run is recorded succeeded with the image's release

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

  # Record §9: each declared event upcast is a background step, level-triggered on its stored events.
  @integration
  Scenario: An upgrade run records each declared event upcast in the ledger
    Given the image declares an upcast from "lw.usage.month_counted" covering 2 stored events
    When the upgrade runs
    Then the ledger holds a step "upcast:entitlement:lw.usage.month_counted" of kind "event-upcast", mode "background", "pending"
    And a later run that finds no stored event of that type records the step "done"

  @integration
  Scenario: An upgrade run that cannot count an upcast's stored events fails
    Given the event log cannot be read
    When the upgrade runs
    Then the run is recorded failed naming the cause

  # Alex, 2026-10-09: the booted tasks process answers its upcasts; the eventing member counts them.
  @unit
  Scenario: The upgrade reads each declared upcast from the booted tasks process
    Given the tasks process declares an upcast whose stored type still has 3 events
    When the upgrade asks for its upcast steps
    Then it receives the upcast's step id with 3 stored events and its pipeline in the report

  @unit
  Scenario: A tasks process without an event log hands the upgrade no upcast steps
    Given the tasks process holds no event log
    When the upgrade asks for its upcast steps
    Then it receives none

  # LangWatchQL's boot convergence only logs a refused DDL (ADR-159); the upgrade's reconciler must not.
  @unit
  Scenario: A LangWatchQL provisioning failure fails the upgrade run
    Given LangWatchQL is configured and its ClickHouse refuses the provisioning DDL
    When the upgrade runs
    Then the run is recorded failed naming the reconciler "langwatchql"

  @unit
  Scenario: pnpm task upgrade runs the upgrade as a run-once worker and answers its exit code
    Given the tasks app is asked to run the upgrade
    When it starts the worker with "upgrade"
    Then the worker runs the upgrade once in its own process and exits 0, 1 or 3
    And the tasks app answers that exit code; status, plan and steps stay reads in the tasks app

  @unit
  Scenario: The worker's upgrade provisions LangWatchQL through the tasks app under its own lease
    Given the worker runs the upgrade in-process
    When its reconcilers run
    Then it runs "pnpm task upgrade lwql-provision", which takes no lease of its own
    And a provisioning that exits non-zero fails the reconciler "langwatchql"

  @integration
  Scenario: Running an older image marks completed background steps pending again
    Given the ledger records a succeeded upgrade to 3.22.0 with a done background step of 3.22.0
    When the upgrade runs from a 3.21.0 image
    Then the 3.22.0 background step is recorded pending

  # Run phases (round 9, U2-PHASES): in the run report, a fixed shape the reader parses.
  @integration
  Scenario: A finished run's report carries its phases
    Given an empty database and a 3.21.0 image
    When the upgrade runs
    Then the run's report lists preflight, then the Postgres and ClickHouse schema phases, then reconcile
    And every phase is succeeded with a start and a finish

  @integration
  Scenario: A schema step recorded done carries the start and finish of its schema phase
    Given an empty database and a 3.21.0 image
    When the upgrade runs
    Then each Prisma step row's start and finish are the Postgres schema phase's
    And each ClickHouse step row's start and finish are the ClickHouse schema phase's

  @integration
  Scenario: A run whose schema fails records the failed phase and no later one
    Given the ClickHouse target fails to apply
    When the upgrade runs
    Then the run's report ends with a failed ClickHouse schema phase
    And no reconcile phase is recorded

  # Live status (round 8, U2-LIVE): the runner raises a read hint; the api relays it.
  @integration
  Scenario: A read hint is published at each phase change and at the finish
    Given a hint publisher
    When the upgrade runs through preflight, one schema release and reconcile
    Then a hint is published as each phase starts and ends, and once when the run finishes
    And each hint names the run, the phase and its outcome under the platform upgrade scope

  @unit
  Scenario: A worker's in-process run publishes its read hints on the worker's Redis
    Given the worker runs the upgrade in its own process with REDIS_URL set
    When the run changes phase
    Then its read hint is published on the worker's Redis, resolved as its stores resolve it
    And the connection opened for the run is closed when the run ends

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

  @unit
  Scenario: upgrade plan --to names the release to preview, and nothing else takes it
    When "upgrade plan --to 3.22.0" is parsed
    Then the plan subcommand previews to 3.22.0
    And "--to" without a release, and "upgrade status --to 3.22.0", are refused by name

  # Writers before the roster (Round 47 E2; ADR-173, amendment 2026-10-08): the deploy, or the
  # chart's opt-in post-upgrade hook once the rollout finished, asserts them gone; a rollback to an
  # image before the roster is recorded by hand, from the new image, before rolling forward again.
  @unit
  Scenario: upgrade takes old-writers-gone and pre-roster-rollback, and nothing after them
    When "upgrade old-writers-gone" or "upgrade pre-roster-rollback" is parsed
    Then each parses as its own subcommand
    And an argument after either is refused by name

  @integration
  Scenario: upgrade old-writers-gone records the assertion and releases the held steps
    Given the ledger was seeded from an existing installation and the upgrade run after it finished
    When "upgrade old-writers-gone" runs
    Then it exits with code 0 and says the steps that wait for old writers may run
    And the ledger reports the assertion after the seed

  @integration
  Scenario: upgrade pre-roster-rollback reopens done background steps and holds old-writers steps again
    Given the background step "trace:backfill-cost" is done and old writers before the roster were asserted gone
    When "upgrade pre-roster-rollback" runs
    Then it exits with code 0 naming "trace:backfill-cost" as reopened
    And "trace:backfill-cost" is pending again
    And the ledger reports the rollback after the assertion

  # Alex, 2026-10-09: the old root migrate scripts keep their names but apply nothing on their own.
  @unit
  Scenario: The root migrate scripts are aliases of the upgrade command
    Given the root package.json scripts "prisma:migrate" and "clickhouse:migrate"
    When either script runs
    Then it builds the bundles first and runs "task upgrade" in the tasks app
    And neither script names the "prisma-migrate" or "clickhouse-migrate" task
    And no CI workflow runs the "prisma-migrate" or "clickhouse-migrate" task

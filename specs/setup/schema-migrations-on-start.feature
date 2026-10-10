# The monolith applied both schemas before it served: platform/app/scripts/
# start.sh ran `start:prepare:db` — prisma:migrate && clickhouse:migrate &&
# lwql:provision — and only then exec'd the app, in development and in
# production alike. The three-process split kept the scripts and lost the call:
# dev/scripts/dev-stack.sh, the api lane haven supervises and `pnpm dev:api`
# all booted the API straight onto whatever schema the database happened to
# have. A developer's database silently fell behind and sign-up answered 500
# on a missing column.
#
# The step then belonged to the API process (and, for the tenant-pass start
# order, the worker too: F11 in dev/docs/plans/migrations-blitz-2026-10-06.md),
# so every serving container migrated on every start. Since the migrations blitz
# (rethink 6.7, Q5) serving processes never migrate: each entry point runs the
# upgrade once before anything serves, and the api and the worker read the
# upgrade ledger at boot and refuse by name when behind. That gate, not a
# migration at start, is what keeps a worker off a schema it was not built for.
#
# See specs/upgrade/entry-points.feature (every entry point),
# specs/upgrade/serving-gate.feature (the refusal) and
# specs/setup/dev-process-topology.feature.

Feature: Schema migrations run before the API serves, never inside it
  As an operator or a developer starting LangWatch
  I want both schemas brought up to date before the API accepts a request
  So that no process ever serves against a schema it was not built for

  # The step is one script, apps/api's `start:prepare:db`: `pnpm task upgrade`
  # alone; the system-migrations pass is not part of api start. Who runs it:
  #
  #   the image           nobody at start: CMD -> apps/api `start` -> the api alone
  #   Helm / compose      the pre-roll Job, the compose `migrate` service
  #   pnpm dev            dev/scripts/dev-stack.sh, once, before the lanes
  #   make haven up       haven's own `prepare` step, once, before the lanes
  #
  # A supervised lane is restarted on a code change and on a crash, so it does
  # not prepare: that is what made a crashlooping api lane migrate every
  # second. See specs/setup/boot-sequence.feature.

  @unit
  Scenario: Serving processes never migrate; they refuse by name when behind
    Given the production start commands of the api and the worker
    When either process is started
    Then it runs only its own entry point and no migration task
    And it composes the upgrade gate, which refuses by name when the ledger is behind

  @unit
  Scenario: The development start path leaves preparation to the stack
    Given a lane that is restarted on a code change and on a crash
    When the lane's development command runs
    Then it starts the process it supervises and migrates nothing

  @unit
  Scenario: A failed upgrade stops the preparation
    Given the upgrade exits non-zero
    When an entry point runs the preparation script
    Then the preparation reports failure, so nothing that waits on it starts

  @unit
  Scenario: An operator can skip a migration step that a deploy already applied
    Given a deploy that migrates elsewhere
    When it sets SKIP_PRISMA_MIGRATE, SKIP_CLICKHOUSE_MIGRATE or SKIP_LWQL_PROVISION to "true"
    Then the step it names does nothing and the boot continues

  @unit
  Scenario: The browser application and the worker never migrate
    Given a stack running all three Node applications
    When the worker process and the browser application start
    Then neither applies a migration
    And the worker composes the same upgrade gate as the API before it consumes jobs

  @unit
  Scenario: The image serves without migrating, and the preparation is written once
    Given the production image's default command
    When a container starts the API
    Then it runs the API's own start path, which migrates nothing
    And the migration steps are not written in the image

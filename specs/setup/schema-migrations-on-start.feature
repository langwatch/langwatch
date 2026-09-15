# The monolith applied both schemas before it served: platform/app/scripts/
# start.sh ran `start:prepare:db` — prisma:migrate && clickhouse:migrate &&
# lwql:provision — and only then exec'd the app, in development and in
# production alike. The three-process split kept the scripts and lost the call:
# dev/scripts/dev-stack.sh, the api lane haven supervises and `pnpm dev:api`
# all booted the API straight onto whatever schema the database happened to
# have. A developer's database silently fell behind and sign-up answered 500
# on a missing column.
#
# The step belongs to the API process when a process is DEPLOYED, because the
# API is the one process that owns the schema: the worker and the browser
# application never migrate, so a deployment has exactly one migrator. Locally
# it belongs to whoever starts the stack, once, because a lane that reloads and
# restarts would otherwise migrate again every time it came back.
#
# See dev/docs/adr/004-docker-dev-environment.md and specs/setup/
# dev-process-topology.feature.

Feature: Schema migrations run before the API serves
  As an operator or a developer starting LangWatch
  I want both schemas migrated before the API accepts a request
  So that no process ever serves against a schema it was not built for

  # The step is one script, `start:prepare:db`, and who runs it depends on
  # whether a process is being deployed or a stack is being started:
  #
  #   the image           CMD -> apps/api `start` -> prepare, then serve
  #   pnpm dev            dev/scripts/dev-stack.sh, once, before the lanes
  #   make haven up       haven's own `prepare` step, once, before the lanes
  #
  # A supervised lane is restarted on a code change and on a crash, so it does
  # not prepare: that is what made a crashlooping api lane migrate every
  # second. See specs/setup/boot-sequence.feature.
  #
  # It runs three tasks from apps/tasks in ONE process, in this order,
  # sequenced so a failure stops the boot: prisma-migrate, clickhouse-migrate,
  # lwql-provision. LangWatchQL provisioning reads both schemas, so it cannot
  # run before either.

  @unit
  Scenario: The API process applies pending schema migrations before it serves
    Given a database with pending migrations
    When the API process is started
    Then the Postgres migrations are applied, then the ClickHouse ones, then LangWatchQL is provisioned
    And only then does the API entry point run

  @unit
  Scenario: The development start path leaves preparation to the stack
    Given a lane that is restarted on a code change and on a crash
    When the lane's development command runs
    Then it starts the process it supervises and migrates nothing

  @unit
  Scenario: A failed migration stops the boot instead of serving
    Given the Postgres migration step fails
    When the API process is started
    Then the remaining migration steps do not run
    And the API entry point never runs
    And the start command reports failure

  @unit
  Scenario: An operator can skip a migration step that a deploy already applied
    Given a deploy that migrates elsewhere
    When it sets SKIP_PRISMA_MIGRATE, SKIP_CLICKHOUSE_MIGRATE or SKIP_LWQL_PROVISION to "true"
    Then the step it names does nothing and the boot continues

  @unit
  Scenario: The worker and the browser application never migrate
    Given a stack running all three Node applications
    When the worker process and the browser application start
    Then neither of them applies migrations
    And the stack has exactly one migrator

  @unit
  Scenario: The image migrates once, through the same script
    Given the production image's default command
    When a container starts the API
    Then it runs the API's own start path
    And the migration steps are not written a second time in the image

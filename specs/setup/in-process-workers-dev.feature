Feature: In-process workers for local development
  As a developer running LangWatch locally
  I want the option to host the background worker stack inside the app process
  So that I can run one process instead of two without giving up background jobs

  # Default in dev is still two processes: `pnpm dev` runs the app and a
  # separate `pnpm run start:workers` lane under concurrently. This feature
  # adds an OPT-IN single-process mode for developers who'd rather run one
  # thing. Production is untouched — it always runs web and worker as separate
  # deployments (charts/langwatch/templates/{app,workers}) and never honours
  # the opt-in flag.
  #
  # The topology is selected by the WORKERS_IN_PROCESS env flag, read in three
  # places:
  #   - scripts/start.sh        — skips the standalone `workers` concurrently
  #                               lane and lets start:app inherit the flag
  #   - scripts/check-ports.sh  — doesn't reserve the worker-metrics port
  #                               (no separate metrics listener in this mode)
  #   - src/start.ts            — boots the App with the "all" role and calls
  #                               startWorkers({ startMetricsServer: false })
  #                               after the server is listening
  #
  # The "all" role runs the same worker-side wiring as "worker" via
  # `roleRunsWorkers(role)` (src/server/app-layer/config.ts): the outbox
  # consumer + drainer, the heartbeat scheduler, and the GroupQueue consumer.
  # `roleRunsWorkers` is bound by src/server/app-layer/__tests__/config.unit.test.ts;
  # the "all" role's outbox wiring is bound by
  # src/server/app-layer/__tests__/presets.outboxWiring.integration.test.ts.

  # --- Default: unchanged two-process dev ---

  @unit
  Scenario: roleRunsWorkers treats worker and all as worker-hosting roles
    Given the ProcessRole values web, worker, migration, and all
    When roleRunsWorkers is evaluated for each
    Then it returns true for "worker" and "all"
    And it returns false for "web", "migration", and undefined

  @unimplemented
  Scenario: pnpm dev keeps running the app and workers as two processes by default
    Given WORKERS_IN_PROCESS is not set
    When I run "pnpm dev"
    Then start.sh adds a separate "workers" lane running "pnpm run start:workers"
    And the app process boots with the web role (no in-process workers)

  # --- Opt-in: single process ---

  @unimplemented
  Scenario: WORKERS_IN_PROCESS=1 hosts the worker stack inside the app process
    Given NODE_ENV is "development" and WORKERS_IN_PROCESS is "1"
    When I run "pnpm dev" (or "pnpm dev:single")
    Then start.sh does not add a separate "workers" lane
    And the app boots with the "all" role
    And the background worker stack starts inside the app process after it is listening

  @integration
  Scenario: the in-process app wires the outbox exactly like a dedicated worker
    Given the App is initialized with the "all" role
    When the event-sourcing pipelines register their outbox reactors
    Then every outbox reactor registers with a runtime (no drop-path warnings)
    And the outbox is wired, so trigger dispatch and settle traffic drain locally

  @unimplemented
  Scenario: a worker boot failure in-process does not take down the web server
    Given WORKERS_IN_PROCESS is "1"
    And the worker stack throws during startup (e.g. a background dependency is down)
    When the app boots
    Then the failure is logged
    And the web server keeps serving requests (only background jobs do not run)

  # --- Production safety ---

  @unimplemented
  Scenario: production ignores WORKERS_IN_PROCESS
    Given NODE_ENV is "production" and WORKERS_IN_PROCESS is "1"
    When the app process starts
    Then it does not host workers in-process
    And web and worker continue to run as separate deployments

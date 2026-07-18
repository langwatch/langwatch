Feature: In-process workers for local development
  As a developer running LangWatch locally
  I want the option to host the background worker stack inside the app process
  So that I can run one process instead of two without giving up background jobs

  # Default for plain `pnpm dev` is still two processes: it runs the app and a
  # separate `pnpm run start:workers` lane under concurrently. This feature
  # adds an OPT-IN single-process mode for developers who'd rather run one
  # thing. Under haven (`pnpm dev:haven`) the default is INVERTED — single
  # process — because a laptop juggling several worktrees can't afford a second
  # Node process per stack; opt back out with WORKERS_IN_PROCESS=0. Production is
  # untouched — it always runs web and worker as separate deployments
  # (charts/langwatch/templates/{app,workers}) and never honours the flag.
  #
  # The topology is selected by the WORKERS_IN_PROCESS env flag, read in four
  # places (all gated on NODE_ENV=development):
  #   - scripts/start.sh        — skips the standalone `workers` concurrently
  #                               lane and lets start:app inherit the flag
  #   - scripts/check-ports.sh  — doesn't reserve the worker-metrics port
  #                               (no separate metrics listener in this mode),
  #                               only when NODE_ENV=development too
  #   - src/start.ts            — boots the App with the "all" role and calls
  #                               startWorkers({ shouldStartMetricsServer: false })
  #                               after the server is listening
  #   - tools/thuishaven (haven) — the hostname-routing launcher (`pnpm dev:haven`)
  #                               DEFAULTS to in-process: it drops its separate
  #                               `workers` child and hosts them in the app child
  #                               (PlanOptions.ShouldRunWorkersInProcess, flipped on
  #                               in cmd/root.go optionsFromEnv). Opt back into a
  #                               standalone `workers` lane with WORKERS_IN_PROCESS=0
  #                               (`pnpm dev:workers:haven`).
  #
  # The "all" role runs the same worker-side wiring as "worker" via
  # `roleRunsWorkers(role)` (src/server/app-layer/config.ts): the GroupQueue
  # consumers, process-manager wake/outbox workers, and the scheduler.
  # `roleRunsWorkers` is bound by src/server/app-layer/__tests__/config.unit.test.ts.

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

  # --- Haven: in-process is the DEFAULT ---

  @unimplemented
  Scenario: haven hosts workers in-process by default
    Given NODE_ENV is "development" and WORKERS_IN_PROCESS is not set
    When I run "pnpm dev:haven"
    Then haven does not add a separate "workers" child
    And the background worker stack starts inside the app process after it is listening
    And the workers keep their "langwatch:workers" logger name, so their lines stay identifiable

  @unimplemented
  Scenario: WORKERS_IN_PROCESS=0 opts haven back into a separate workers lane
    Given NODE_ENV is "development" and WORKERS_IN_PROCESS is "0"
    When I run "pnpm dev:workers:haven"
    Then haven adds a separate "workers" child running "pnpm run start:workers"
    And the app child boots without hosting workers in-process

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

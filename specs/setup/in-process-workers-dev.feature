# ADR-111 preserves the single-process experience but moves its parent from the
# application process to tools/dev-runtime. This feature characterizes the
# pre-extraction physical implementation and is retired when that migration
# stage lands; specs/dependencies/runtime-composition.feature owns the enduring
# combined-runtime behaviour.

@deprecated
Feature: In-process workers for local development
  As a developer running LangWatch locally
  I want the background worker stack hosted inside the app process by default
  So that I run one process instead of two without giving up background jobs

  # Plain `pnpm dev` is a SINGLE process: it sets WORKERS_IN_PROCESS=1 and hosts
  # the worker stack inside the app, with no separate `workers` lane. haven
  # already defaulted this way, so a laptop juggling several worktrees never
  # pays for a second Node process per stack — and plain `pnpm dev` disagreeing
  # with haven was the surprise rather than the safeguard.
  #
  # The dev surface is four scripts, no flags to remember:
  #   pnpm dev             app + workers in ONE process (the default)
  #   pnpm dev:app         app only, no workers
  #   pnpm dev:worker      workers only
  #   pnpm dev:concurrent  app + workers as two processes, as prod deploys them
  #
  # Opt back out under haven with `haven up +workers` (sticky, ADR-064 — haven
  # no longer reads WORKERS_IN_PROCESS=0 as a selection, it refuses it and names
  # `+workers`). Production is untouched — it always runs web and worker as
  # separate deployments (charts/langwatch/templates/{app,workers}) and never
  # honours the flag.
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
  #   - tools/thuishaven (haven) — the hostname-routing launcher (`make haven up`)
  #                               DEFAULTS to in-process: the sticky selection's
  #                               Workers field is off unless `haven up +workers`
  #                               turned it on (domain.Selection, ADR-064), so the
  #                               plan hosts the workers in the app child. Opt into
  #                               a standalone lane with `haven up +workers`.
  #
  # The "all" role runs the same worker-side wiring as "worker" via
  # `roleRunsWorkers(role)` (src/server/app-layer/config.ts): the GroupQueue
  # consumers, process-manager wake/outbox workers, and the scheduler.
  # `roleRunsWorkers` is bound by src/server/app-layer/__tests__/config.unit.test.ts.

  # --- The default: one process ---

  @unit
  Scenario: roleRunsWorkers treats worker and all as worker-hosting roles
    Given the ProcessRole values web, worker, migration, and all
    When roleRunsWorkers is evaluated for each
    Then it returns true for "worker" and "all"
    And it returns false for "web", "migration", and undefined

  @unimplemented
  Scenario: pnpm dev hosts the worker stack inside the app process
    Given NODE_ENV is "development"
    When I run "pnpm dev"
    Then it sets WORKERS_IN_PROCESS=1
    And start.sh does not add a separate "workers" lane
    And the app boots with the "all" role
    And the background worker stack starts inside the app process after it is listening

  # --- Opting out, one side at a time ---

  @unimplemented
  Scenario: pnpm dev:concurrent runs the app and workers as two processes
    Given WORKERS_IN_PROCESS is not set
    When I run "pnpm dev:concurrent"
    Then start.sh adds a separate "workers" lane running "pnpm run start:workers"
    And the app process boots with the web role (no in-process workers)

  @unimplemented
  Scenario: pnpm dev:app runs the app with no workers at all
    Given neither WORKERS_IN_PROCESS nor START_WORKERS is set
    When I run "pnpm dev:app"
    Then start.sh adds no "workers" lane
    And the app process boots with the web role
    And no background jobs run

  @unimplemented
  Scenario: pnpm dev:worker runs the worker stack on its own
    When I run "pnpm dev:worker"
    Then it prepares the generated files and runs "pnpm run start:workers"
    And no web server is started

  # --- Haven: in-process is the DEFAULT ---

  @unimplemented
  Scenario: haven hosts workers in-process by default
    Given NODE_ENV is "development" and WORKERS_IN_PROCESS is not set
    When I run "make haven up"
    Then haven does not add a separate "workers" child
    And the background worker stack starts inside the app process after it is listening
    And the workers keep their "langwatch:workers" logger name, so their lines stay identifiable

  @unimplemented
  Scenario: haven up +workers opts into a separate workers lane
    Given the worktree's sticky selection includes workers
    When I run "haven up" (or "haven up +workers")
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

# Replaces specs/setup/in-process-workers-dev.feature, which described a mode
# that no longer exists. `platform/app` is gone; the product is three Node
# applications, and each is its own process in development exactly as it is in
# production. See dev/docs/adr/004-docker-dev-environment.md
# ("Amendment: three processes, no in-process worker, 2026-09-03").

Feature: The local development process topology
  As a developer running LangWatch locally
  I want every entry point to run the same three applications
  So that a stack can never boot looking healthy while processing no jobs

  # The three Node lanes are ui (apps/ui, Vite), api (apps/api) and workers
  # (apps/worker). Every entry point runs all three:
  #
  #   pnpm dev            dev/scripts/dev-stack.sh, under concurrently
  #   make haven up       three supervised children (tools/thuishaven)
  #   make quickstart …   the ui, api and workers compose services
  #
  # None of them is selectable. There is no in-process worker mode to choose,
  # no "all" process role, and no roleRunsWorkers: WORKERS_IN_PROCESS and
  # START_WORKERS are dead variables that nothing reads.
  #
  # Ports are derived from PORT (default 5560): ui on PORT, api on PORT + 1000,
  # the worker's metrics/healthz listener on PORT - 2561, and the AI Gateway on
  # PORT + 3.

  # --- Every entry point runs all three ---

  @unit
  Scenario: Every stack runs the three Node lanes
    Given a worktree with no service selection of its own
    When haven plans the stack's children
    Then it plans a "ui" lane, an "api" lane and a "workers" lane
    And each runs its own workspace package's dev script from the workspace root
    And no lane carries WORKERS_IN_PROCESS or START_WORKERS

  @unit
  Scenario: A retired service delta is refused by name
    Given a developer typing "haven up +workers" or "haven up -workers"
    When the selection deltas are applied
    Then the command is refused
    And the refusal says the background worker is its own process now

  @unit
  Scenario: A knob nothing reads is refused whichever way it is set
    Given an environment carrying WORKERS_IN_PROCESS or START_WORKERS
    When "haven up" runs
    Then it refuses whichever value the variable carries
    And it says the variable no longer does anything, naming no replacement

  # --- Restarting one lane cannot reach another ---

  @unit
  Scenario: Bouncing the workers lane touches only its own process group
    Given a running stack
    When "haven restart workers" runs
    Then only the process group holding the worker metrics port is terminated
    And the API's group is untouched

  # --- The port pre-flight ---

  @unimplemented
  Scenario: The pre-flight reserves all three Node ports
    Given NODE_ENV is "development"
    When the dev launcher checks its ports
    Then it reserves PORT, PORT + 1000 and PORT - 2561
    And it suggests a free slot only where all three are free

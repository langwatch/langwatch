# Replaces specs/setup/in-process-workers-dev.feature, which described a mode
# that no longer exists. `[gone]` is gone; the product is three Node
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

  @unit
  Scenario: The pre-flight reserves all three Node ports
    Given NODE_ENV is "development"
    When the dev launcher checks its ports
    Then it reserves PORT, PORT + 1000 and PORT - 2561
    And it suggests a free slot only where all three are free

  # --- The launcher hands each lane the port it derived ---

  # Deriving a port and not handing it over is the same as not deriving it.
  # `pnpm dev` computed the api lane's port and kept it to itself, so the api
  # process fell through to PORT — the browser application's — read out of the
  # workspace `.env`, and died on boot with EADDRINUSE. Everything downstream
  # read as a different fault entirely: every Vite proxy attempt was an
  # ECONNREFUSED stack, and the gateway called the control plane unreachable.
  #
  # One derivation, one place, and every consumer reads it: the pre-flight that
  # reserves the ports and the launcher that hands them out cannot disagree
  # about which port a lane gets.

  @unit
  Scenario: Each lane is told the port that was derived for it
    Given a dev launcher deriving its ports from PORT
    When it starts the lanes
    Then the api lane is given PORT + 1000, not the browser application's port
    And the worker is given the metrics port the pre-flight reserved
    And the AI Gateway is given the port the launcher announced

  # `--env-file-if-exists` never overwrites a variable that is already set, so
  # exporting is what makes the derived value beat the committed one. A lane
  # that only inherited it in the launcher's own shell would be handed the
  # `.env` value the moment its entry point loaded the file.
  @unit
  Scenario: A derived port beats the value committed in the workspace env file
    Given the workspace env file names a port for the browser application
    When a lane is started with a port the launcher derived
    Then the lane binds the derived port

  @unit
  Scenario: A port the developer set themselves is left alone
    Given a developer who set the api port explicitly
    When the launcher derives its ports
    Then their value is kept and nothing is derived over it

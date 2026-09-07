# Replaces specs/setup/in-process-workers-dev.feature, which described a mode
# that no longer exists. `[gone]` is gone; the product is three Node
# applications, each its own deployment in production. See
# dev/docs/adr/004-docker-dev-environment.md.
#
# LOCALLY the api and the worker share ONE process and the Go data-plane
# services share another — the 2026-09-07 amendment, specified in
# specs/setup/haven-local-topology.feature. What survives here is what did not
# change: the ports, the pre-flight, the port hand-off, and the fact that no
# variable can move work between lanes. What lanes there ARE, and how one is
# restarted, is the other file's subject.

Feature: The local development process topology
  As a developer running LangWatch locally
  I want every entry point to run the same three applications
  So that a stack can never boot looking healthy while processing no jobs

  # No lane is selectable. There is no in-process worker MODE to choose, no
  # "all" process role, and no roleRunsWorkers: WORKERS_IN_PROCESS and
  # START_WORKERS are dead variables that nothing reads. The local launcher
  # that hosts the api and the worker together is exactly that — a launcher,
  # not a role — and no value of either variable changes what it starts.
  #
  # Ports are derived from PORT (default 5560): ui on PORT, api on PORT + 1000,
  # the worker's metrics/healthz listener on PORT - 2561, and the AI Gateway on
  # PORT + 3.

  # --- No knob moves work between lanes ---
  #
  # Which lanes a stack runs is specs/setup/haven-local-topology.feature's
  # subject.

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

  # Restarting one lane cannot reach another: see
  # specs/setup/haven-local-topology.feature.

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
    Then the API is given PORT + 1000, not the browser application's port
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

  # --- Debounced restart on change ---

  # A watcher that restarts the instant a file changes, with no quiet window,
  # turns an agent editing five files across a feature package in the same
  # second into five restarts — five reconnects to Postgres/ClickHouse/Redis.
  # dev/scripts/dev-supervisor.mjs's `--watch` mode wraps the command with a
  # debounced quiet window instead (LANGWATCH_DEV_WATCH_DEBOUNCE_MS, default
  # 750 ms), coalescing a burst into one restart. See
  # dev/scripts/__tests__/dev-supervisor-watch.unit.test.mjs.

  # Hundreds of files over several seconds, in bursts with gaps between them,
  # is what an agent renaming across a feature package actually writes. A short
  # window turns that into a restart per gap.
  @unit
  Scenario: A write storm from an agent restarts the backend once
    Given the backend lane running under a debounced watch
    When an agent writes hundreds of files in bursts inside the quiet window
    Then exactly one restart happens once the tree is still
    And every file that contributed is named to it

  @unit
  Scenario: A burst of source changes restarts the API once
    Given the backend lane's dev script running under a debounced watch
    When five files change within the same quiet window
    Then exactly one restart happens
    And it reports how many files triggered it

  # --- The worker drains before a restart takes it down ---

  # A restart is a takedown-and-respawn: SIGTERM, then SIGKILL only after a
  # grace period. The worker's own shutdown handler
  # (apps/worker/src/platform/lifecycle/worker.signals.ts) treats SIGTERM as
  # "finish what is running, then exit" — an in-flight GroupQueue job gets a
  # chance to complete instead of being cut off mid-job.

  @unit
  Scenario: A restart lets the worker drain before it exits
    Given a running process that finishes its own shutdown work on SIGTERM
    When a restart takes it down
    Then it is given the chance to finish before anything forces it
    And a process that ignores SIGTERM is still killed once the grace period elapses

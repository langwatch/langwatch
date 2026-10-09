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

  # A worktree's `.env` is often copied from another checkout, so its
  # LANGWATCH_API_URL names that checkout's api. The ui then serves this stack
  # while every /api call lands on the other one.
  @unit
  Scenario: The browser application's api proxy follows the derived api port
    Given the workspace env file names another stack's api address
    When the launcher starts on a non-default PORT
    Then the browser application's lane is told the api address on PORT + 1000

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

  # A module's browser half cannot reach the backend: the architecture
  # enforcer forbids api/worker code from importing a browser package. That
  # guarantee is the reason a browser-only edit must NOT restart the backend
  # — it reloads code that provably cannot have changed. With several sessions
  # sharing one checkout, watching them means one session's screen work
  # bounces another's API, and each bounce races the worker onto its metrics
  # port.
  @unit
  Scenario: A browser-half edit leaves the backend lane alone
    Given the backend lane running under a debounced watch
    When a file changes in a module's browser package
    Then the change is not worth a restart

  # tsup and vite bundle their own config into a temp file beside it
  # (`tsup.config.bundled_<hash>.mjs`) and delete it when the build ends. It is
  # not source, nothing imports it, and `ensure:built` runs on every lane's
  # predev and every scoped test — so on a shared checkout one session's build
  # restarted another session's api, once per build.
  @unit
  Scenario: A build tool's own temp config leaves the backend lane alone
    Given the backend lane running under a debounced watch
    When a build tool writes its bundled config beside the package
    Then the change is not worth a restart

  @unit
  Scenario: An agent's import-graph probe leaves the backend lane alone
    Given the backend lane running under a debounced watch
    When an agent writes a probe file into a watched source directory
    Then the change is not worth a restart
    # Probes are written and deleted seconds apart. Boot is slower than that
    # gap, so a stack shared with a probing session never finished starting.

  # An agent writes one file per tool call, seconds apart, so a short window
  # sees every edit as its own burst. The window restarts on each change, which
  # would starve the restart under a steady trickle: the max wait bounds it.
  @unit
  Scenario: A steady trickle of edits still restarts within the max wait
    Given the backend lane running under a debounced watch
    When files keep changing so the quiet window never elapses
    Then the restart fires once the max wait since the first change has passed

  # --- The api lane reloads in-process (ADR-168, B1) ---

  # Restarting the whole process for every edit left a shared checkout's api
  # booting most of the time. The api lane now loads api and worker through a
  # Vite module runner and re-links only what an edit reaches; the supervisor
  # keeps the process, and LANGWATCH_DEV_RELOAD=process restores the old restart.
  @unit
  Scenario: A module edit reloads in-process without a new process
    Given the api lane reloading in-process under the supervisor
    When a backend source file the runner loaded changes
    Then only that module and the modules importing it are evaluated again
    And the supervisor does not restart the process, so its pid stays the same

  # Node loaded a package.json's resolution and the host's own source natively,
  # so no module runner can drop them: those still need a new process.
  @unit
  Scenario: Only what Node loaded natively restarts the in-process api lane
    Given the api lane reloading in-process under the supervisor
    When a package.json or a file of the host's own source changes
    Then the supervisor restarts the process
    And a module edit elsewhere is left to the in-process reload

  # A bad edit never exits an in-process host (the old generation keeps
  # serving), so an exit after it said "backend ready" is a crash.
  @unit
  Scenario: An in-process api lane that crashes after booting is started again
    Given the api lane reloading in-process under the supervisor
    And the process has said it is ready
    When the process exits non-zero
    Then the supervisor starts it again after the quiet window, without waiting for a change

  # Only the packages the backend can load matter. pnpm resolves declared
  # dependencies only, so a workspace package that no backend dependency reaches
  # (design-system, browser-host) cannot be on its import graph.
  @unit
  Scenario: A browser-only package leaves the backend lane alone
    Given the backend lane running under a debounced watch
    When a file changes in a workspace package the backend does not depend on
    Then the change is not worth a restart

  @unit
  Scenario: Prose, specs and tool config leave the backend lane alone
    Given the backend lane running under a debounced watch
    When a markdown file, a feature file or a tsconfig changes
    Then the change is not worth a restart

  # --- One reload at a time ---

  # 44% of restarts landed mid-boot, and the second one ran beside the first:
  # two backends, one port, EADDRINUSE. A change while a reload is running is
  # queued and answered by exactly one follow-up when that boot settles (the
  # child says "backend ready", exits, or LANGWATCH_DEV_BOOT_SETTLE_MS passes).
  @unit
  Scenario: Changes during a reload queue exactly one follow-up
    Given the backend lane is booting after a restart
    When several files change before the boot settles
    Then no second backend starts beside the first
    And exactly one follow-up restart happens after the boot settles, naming every file

  # A half-written import crashes boot. Exiting would end the lane: haven
  # respawns it every second, and `pnpm dev`'s concurrently takes the stack down.
  @unit
  Scenario: A crashed boot waits for the next change instead of ending the lane
    Given the backend lane running under a debounced watch
    When the backend exits non-zero
    Then the supervisor stays up and says once that it is waiting for a change
    And the next change starts the backend again

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

  # --- Developer tools start on the first visit and stop once idle ---

  # Storybook and the mail preview used to run until the dev server stopped,
  # pnpm wrappers and compiler helpers included. The ui lane's dev server holds
  # each tool's port (apps/ui/vite/dormant-dev-tool.ts), with or without haven;
  # haven only routes a hostname to that port.

  @unit
  Scenario: A developer tool stays dormant until someone visits it
    Given the ui lane's dev server is running
    When nobody has opened Storybook or the mail preview
    Then neither tool's process is running
    And each tool's port still answers
    When someone opens the tool's page
    Then the tool starts and the page is served by it

  @unit
  Scenario: A health probe does not wake a dormant developer tool
    Given a dormant developer tool
    When a health checker, Vite's ping or a HEAD request reaches the tool's port
    Then the probe gets an answer
    And the tool stays dormant

  @unit
  Scenario: Concurrent first visits start one developer tool
    Given a dormant developer tool
    When several first visits arrive at once
    Then the tool is started once and every visit is served by it

  @unit
  Scenario: An idle developer tool is shut down with its whole process chain
    Given a developer tool that was visited and then left idle past the idle bound
    Then the dev server stops the tool's whole process group, pnpm wrappers included
    And the next visit starts it again

  @unit
  Scenario: A pinned developer tool stays running when idle
    Given the developer pinned the tools open with "LANGWATCH_DEV_TOOLS_IDLE=off"
    When a visited tool sits idle
    Then it keeps running

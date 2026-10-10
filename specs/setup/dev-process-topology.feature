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
  # Ports are derived from PORT (default 5560): ui on PORT, api on PORT + 1000
  # (on PORT itself under plain `pnpm dev`, which runs no ui lane),
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

  # --- haven rebuilds and swaps the stack's Go child (HAVEN-SWAP, HAVEN-REBUILD) ---

  # haven's own watch replaced air: it builds ./cmd/service into
  # .bin/combined/<lane> and runs `combined` from it. Tests are not watched.
  # It runs under "haven up --watch" and "--hmr" (HAVEN-WATCH-DEFAULT); LANGWATCH_GO_WATCH=0 keeps it off.
  @unit
  Scenario: A watched go lane runs haven's own Go watch, not air
    Given a stack started with "haven up --watch"
    When haven plans the go lane
    Then the lane runs "haven go-watch" with the lane's binary path and services
    And no lane runs "make service-watch"

  @unit
  Scenario: A Go edit burst rebuilds the combined child once, after the quiet window
    Given the go lane running under haven's Go watch
    When several Go source files change less than LANGWATCH_DEV_WATCH_DEBOUNCE_MS (2000 by default) apart
    Then one rebuild starts once that quiet window has passed since the last change
    And the new child replaces the old one in sequence: the old one stops, then the new one starts

  @unit
  Scenario: A steady trickle of Go edits still rebuilds within the max wait
    Given the go lane running under haven's Go watch
    When Go files keep changing so the quiet window never elapses
    Then the rebuild fires once LANGWATCH_DEV_WATCH_MAX_WAIT_MS (30000 by default) has passed since the first change

  @unit
  Scenario: A failed Go build keeps the running child
    Given the go lane running under haven's Go watch
    When a Go change does not compile
    Then the compile error is written to the go lane's log
    And the running child keeps serving until a later change builds

  @unit
  Scenario: The Go watcher runs only when the stack watches
    Given LANGWATCH_GO_WATCH is unset
    Then "haven up --watch" and "haven up --hmr" watch the Go services
    And a plain "haven up", or LANGWATCH_GO_WATCH=0, runs them without a watcher

  # --- The api lane reloads in-process (ADR-168, B1) ---

  # Restarting the whole process for every edit left a shared checkout's api
  # booting most of the time. The api lane now loads api and worker through a
  # Vite module runner and re-links only what an edit reaches; no supervisor
  # keeps the process, and LANGWATCH_DEV_RELOAD=process restores the old restart.
  @unit
  Scenario: A module edit reloads in-process without a new process
    Given the api lane reloading in-process in-process
    When a backend source file the runner loaded changes
    Then only that module and the modules importing it are evaluated again
    And the process is not restarted, so its pid stays the same

  # Node loaded the host's own source natively, so no module runner can drop it;
  # restarting for it took the whole stack down, so it waits for a manual restart.
  # A bad edit never exits an in-process host (the old generation keeps
  # serving), so an exit after it said "backend ready" is a crash.
  # ADR-168 step 5: a generation's own close is what releases its stores,
  # queues and pools, so it runs before the next worker boots (the next api
  # boots beside it on its own port, see the swap scenarios below).
  @unit
  Scenario: A reload disposes the previous generation before the next one boots
    Given the api lane reloading in-process in-process
    And a generation serving that attached process listeners while it ran
    When a module edit links the next generation
    Then the old generation drains, worker first and then the api
    And the listeners it left attached are taken off after the drain
    And listeners the next generation attached while linking stay attached

  # Module-level state leaks a little per generation; a fresh process bounds it.
  @unit
  Scenario: The in-process api lane hands over to a fresh process after enough generations
    Given the api lane reloading in-process in-process
    And it has served LANGWATCH_DEV_RECYCLE_GENERATIONS generations (50 by default)
    When the next module edit arrives
    Then the host logs "backend recycling" with the generation limit as its reason
    And it drains and exits non-zero, so the dev script's loop (or haven's lane) starts a fresh process

  @unit
  Scenario: The in-process api lane hands over to a fresh process once its memory passes the ceiling
    Given the api lane reloading in-process in-process
    And its RSS is above LANGWATCH_DEV_RECYCLE_RSS_MIB (8192 by default)
    When the next module edit arrives
    Then the host logs "backend recycling" with the RSS ceiling as its reason
    And it drains and exits non-zero, so the dev script's loop (or haven's lane) starts a fresh process

  @unit
  Scenario: A generation that did not drain is replaced by a fresh process
    Given the api lane reloading in-process in-process
    When the old generation's drain fails during a reload
    Then the host does not start the next worker beside it
    And it logs "backend recycling" and exits non-zero, so the dev script's loop (or haven's lane) starts a fresh process

  # --- The simulators' switch (ADR-168, amendment 2026-10-10) ---

  # No process hosts the UI's Vite server beside the backend any more (see "An
  # hmr stack runs Vite as its own ui lane beside the backend"), so
  # LANGWATCH_DEV_ONE_PROCESS no longer touches the Node lanes: it folds the
  # simulators into the go lane, and =0 gives them a sims lane.
  # HAVEN-ONE-SWITCH: the old Go name is read only while the new one is unset.
  @unit
  Scenario: LANGWATCH_GO_ONE_PROCESS is a warned alias of the one switch
    Given LANGWATCH_DEV_ONE_PROCESS is unset and LANGWATCH_GO_ONE_PROCESS is set
    When haven up reads its options
    Then the alias value is used and one deprecation warning names LANGWATCH_DEV_ONE_PROCESS
    And haven up refuses to start when both are set and disagree

  # The one-process host debounces exactly as the split backend lane does: its
  # watch is live before the first boot, and that boot is a reload too.
  @unit
  Scenario: A change during the one-process host's boot is answered by one follow-up reload
    Given the one-process host watching backend source
    When files it loaded change while a boot, the first one included, is still running
    Then no second reload starts on top of the boot
    And once the boot settles one follow-up reload carries every changed file

  # Only the packages the backend can load matter. pnpm resolves declared
  # dependencies only, so a workspace package that no backend dependency reaches
  # (design-system, browser-host) cannot be on its import graph.
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

  @unit
  Scenario: A stopped developer tool revives for a tab left open
    Given a developer tool that was stopped while its page stayed open in a tab
    When the tab's websocket reconnects
    Then the connection is refused with a retry hint and the tool is started
    And the tab's next attempt reaches the running tool

  @unit
  Scenario: A restarted dev server takes its developer tool port back
    Given the dev server restarts while the old server still holds a tool's port
    When the new dev server binds the port
    Then it retries until the port is released
    And the tool is not reported as external

  @unit
  Scenario: A hosted developer tool runs inside the dev server's own process
    Given a developer tool that the dev server hosts rather than spawns
    When someone opens the tool's page
    Then the tool starts inside the dev server's process and serves the page
    And once idle past the bound it is closed, and the next visit starts it again

  @unit
  Scenario: The mail preview runs inside the dev server unless asked to run apart
    Given the ui lane's dev server is running
    Then the mail preview is hosted in the dev server's own process
    When the developer sets "LANGWATCH_MAIL_PREVIEW_SPAWN=1"
    Then the mail preview starts as its own process on the first visit

  # --- A reload never closes the api's port ---

  # A shared checkout reloads the backend many times an hour; draining before
  # booting left API_PORT closed for the whole boot, so every page was a 502.
  # The host holds API_PORT and forwards it; the worker binds fixed ports
  # (metrics, voice raw socket), so it still stops before its successor starts.
  @unit
  Scenario: A reload swaps the api without closing its port
    Given the in-process host forwarding API_PORT to a serving generation
    When a module edit links the next generation
    Then the next api boots on its own port while the old one still answers
    And API_PORT is moved to the next api before the old generation drains
    And the next worker starts only after the old worker has drained

  @unit
  Scenario: An api that refuses boot keeps the old generation serving
    Given the in-process host forwarding API_PORT to a serving generation
    When the next api throws while booting
    Then API_PORT stays with the old generation and nothing is drained

  @unit
  Scenario: A worker that refuses boot leaves the new api serving
    Given the in-process host forwarding API_PORT to a serving generation
    When the next worker throws while booting after the old one drained
    Then the new api keeps serving and the worker's failure is logged by name
    And the next code change retries the boot

  # --- A half that fails to boot is loud and retried (Alex, 2026-10-10) ---

  # A worker that threw on boot used to drain the api too, so every page was a
  # bare 502 until the next file change. Now the api keeps serving and says why.
  @unit
  Scenario: A worker that fails to boot never takes the api down
    Given the backend launcher booting the api and the worker
    When the worker throws while booting
    Then the api keeps serving and the worker's failure is a fatal record naming it
    And every app page carries a banner naming the worker, its error and when it retries
    And the banner is gone once a retry boots the worker

  @unit
  Scenario: A backend that cannot serve answers every request with why
    Given the in-process host holding API_PORT with no api serving after a failed boot
    When a browser asks for a page
    Then it gets a 503 page naming the half, the error message and stack, the retry time and "haven logs api"
    And an API request gets a JSON 503 with the same fields

  @unit
  Scenario: A failed boot retries on its own with a backoff
    Given a backend boot that failed
    Then it is retried after 2 seconds, 5 seconds, 15 seconds and then every 30 seconds
    And a code change or a boot that succeeds starts the schedule over

  # --- One mode switch, and a still stack reloads on demand (ADR-064 amendment 2026-10-10 b) ---

  # `haven up` is still: nothing reloads on a file change, and the Node host
  # gets LANGWATCH_DEV_WATCH=0. `haven up --watch` rebuilds and reloads
  # everything; `haven up --hmr` does too, with Vite HMR for the UI. The mode
  # is never saved: each `haven up` uses only the flags passed.
  @unit
  Scenario: A still stack runs its Node host without a backend reload on change
    Given a stack started with "haven up"
    When haven plans the Node lanes
    Then each lane's env sets LANGWATCH_DEV_WATCH=0
    And a stack started with "--watch" or "--hmr" reloads its backend on a change

  @unit
  Scenario: The stack mode is not sticky
    Given a stack running with "haven up --watch"
    When the developer runs a plain "haven up"
    Then the stack restarts still, with no "--force"
    And a .haven.json that names "held", "watch", "watch-ui", "bundled-ui" or "dev-ui" is read as still
    And the next write of .haven.json drops those keys

  @unit
  Scenario: Status names the stack mode
    Given a running stack
    When the developer runs "haven status" or "haven status --json"
    Then each stack names its mode as one field: still, watch or hmr

  @unit
  Scenario: Reload waits for the host to finish, not for a pause
    Given a running still stack and a log with an old ready line
    When "haven reload" signals the host
    Then it returns only once a new "backend reload finished" or "backend ready" line is logged

  # --- A built UI serves the production bundle from the api (2026-10-10) ---

  # Still and watch serve the built UI: one backend-only Node lane, no Vite;
  # the api serves apps/ui/dist/client, built once at up and on `haven reload
  # ui`. watch rebuilds it with `haven ui-watch` on a change. hmr runs Vite
  # bundledDev with HMR in its own lane. Outside haven `pnpm dev` matches still
  # and watch (the UI built once, the backend lane serving it on PORT and
  # reloading) and `pnpm dev:hmr` adds the Vite ui lane.
  @unit
  Scenario: A plain haven up serves the built UI and holds it still
    Given a stack started with "haven up"
    When haven plans the Node lanes
    Then one backend-only host runs after a fresh build, with no Vite server and no ui lane
    And the app hostname routes to the api port
    And no file change rebuilds the bundle until "haven reload ui"

  @unit
  Scenario: A watch UI stack rebuilds the built UI on a change
    Given a stack started with "haven up --watch"
    When haven plans the Node lanes
    Then one backend-only host runs after a fresh build and marks its pages as watch-mode pages
    And a ui lane runs "haven ui-watch", one build per settled burst of edits
    And a failed rebuild leaves the last good bundle serving
    And a backend change reloads the host in place

  @unit
  Scenario: An open watch-mode page reloads after a swap only once idle
    Given a page served by a watch UI stack
    When a new bundle is swapped in, or a chunk the page asks for is gone
    Then the page reloads once nobody has touched it for 60 seconds, or at once when hidden
    And a page from a built or production server reloads at once on a stale chunk and never polls

  @unit
  Scenario: An hmr stack runs Vite as its own ui lane beside the backend
    Given a stack started with "haven up --hmr"
    When haven plans the Node lanes
    Then a ui lane runs the UI's Vite dev server with LANGWATCH_UI_BUNDLED=1
    And a separate api lane hosts the api and the worker and reloads on a change
    And no lane hosts Vite inside the backend process
    And "haven reload ui" is refused, because Vite reloads itself

  @unit
  Scenario: A built UI is rebuilt beside the served one and swapped in
    Given a stack serving a built UI
    When "haven reload ui" runs
    Then the new bundle is built beside the served one
    And the old assets stay loadable by open pages, until 24 hours after they were superseded
    And stack start drops every asset the served build does not list
    And the bundles swap only once the build succeeded

  # --- Every haven console is built, never a dev server (2026-10-10) ---

  # The simulator consoles and haven's own hub are Vite builds embedded in the Go
  # binary that serves them; `haven self install --build` and each simulator lane build
  # them through nx (tag haven-console). The design system's Storybook is built
  # with `storybook build` and served by haven's own binary on the design-system
  # lane; the mail studio is pre-rendered by `build:studio` and served on the
  # mail-room lane, read-only (Alex 2026-10-10: built or bundled, never dev).
  @unit
  Scenario: Every haven console is served built, never by a dev server
    Given a stack that selected every simulator, the design system and the mail room
    When haven plans its lanes
    Then every simulator console is the built bundle its Go binary embeds
    And the design-system lane builds the Storybook when its output is missing or stale
    And serves the built files with haven's own static server
    And no lane runs "storybook dev", "vite" or HMR for a console
    And the ui lane frames that built Storybook at "/design-system" instead of starting one
    And the mail-room lane renders every fixture at build time and serves the files with haven's own static server
    And the ui lane never starts the mail studio's dev server


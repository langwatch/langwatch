# The local process topology: two Node lanes and one Go lane, not six
# processes. See dev/docs/adr/004-docker-dev-environment.md
# ("Amendment: two local processes — backend and go, 2026-09-07"), which
# reverses the 2026-09-03 amendment FOR DEVELOPMENT ONLY. Production is
# unchanged: three Node deployments and each Go service its own container.

Feature: The local development topology
  As a developer running LangWatch locally
  I want the api and the worker in one process and the Go services in another
  So that a laptop running several worktrees pays for two runtimes, not six

  # What the 2026-09-03 amendment was really protecting against was never the
  # process count. It was the SWITCH: WORKERS_IN_PROCESS and START_WORKERS let a
  # stack be configured into a topology nobody could see, so a stack that served
  # pages and processed no jobs looked healthy. Both are dead and stay dead —
  # the backend lane is a launcher, not a process role, and no value of either
  # variable changes what it starts.
  #
  #   ui       apps/ui             Vite, on PORT
  #   backend  tools/dev-runtime   the api AND the worker application, one process
  #   go       cmd/service         aigateway AND nlpgo, one process
  #   langy    services/langyagent its own lane, optional
  #
  # Ports are unchanged: ui on PORT, api on PORT + 1000, worker metrics on
  # PORT - 2561, gateway on PORT + 3.

  # --- The backend process ---

  @unit
  Scenario: The backend process starts the worker before the API
    Given the backend launcher booting both applications
    When it starts
    Then the worker application is started first
    And the API application is started after it

  @unit
  Scenario: A half-started backend drains what it did start
    Given a worker that started and an API that refuses to boot
    When the backend launcher boots
    Then the worker is closed before the failure is reported
    And the caller is left with no half-started process to handle

  # The worker's jobs call back into the API's in-process graph. Closing the
  # listener first fails them mid-drain, and a job that fails during shutdown
  # is indistinguishable from one that failed on its merits.
  @unit
  Scenario: Shutdown drains the worker before closing the API listener
    Given a running backend process
    When it is asked to stop
    Then the worker is drained first
    And the API listener is closed after it

  @unit
  Scenario: A stuck drain still closes the API listener
    Given a worker whose drain throws
    When the backend process shuts down
    Then the API listener is still closed
    And the drain's failure is still reported

  # Each executable takes a host precisely so something can embed it. Given the
  # real process, the first of the two to hear SIGTERM would end the process
  # while the other was still draining.
  @unit
  Scenario: Neither hosted application owns the process's signals
    Given both applications embedded in the backend process
    When one of them subscribes to a signal or asks to exit
    Then its subscription reaches nothing
    And its exit request reaches the one shutdown the process owns

  # --- The Go process ---

  @unit
  Scenario: The combined Go process hosts the data-plane services
    Given no service named on the command line
    When "service combined" starts
    Then it hosts the AI Gateway and the NLP engine
    And "combined" is a dispatchable subcommand of the mono-binary

  @unit
  Scenario: The combined Go process keeps each service's telemetry identity
    Given the two services sharing one process
    When each reports a signal
    Then it carries the same service name it carries when it runs alone

  # SERVER_ADDR cannot address two listeners in one process. Each service is
  # handed the port the launcher reserved for its own hostname.
  @unit
  Scenario: Each hosted service binds the port it was allocated
    Given the combined process hosting both services
    When it resolves each service's address
    Then no service reads SERVER_ADDR
    And no two services read the same address variable

  @unit
  Scenario: An unknown combined service is refused by name
    Given a caller naming a service the combined process does not host
    When the selection is resolved
    Then the command is refused
    And the refusal names the service it would not host

  # --- The lanes haven plans ---

  @unit
  Scenario: Every stack runs the ui and backend lanes
    Given a worktree with no service selection of its own
    When haven plans the stack's children
    Then it plans a "ui" lane and a "backend" lane
    And neither an "api" lane nor a "workers" lane is planned
    And no lane carries WORKERS_IN_PROCESS or START_WORKERS

  @unit
  Scenario: The Go data-plane services share one lane
    Given a stack that selected the gateway and the NLP engine
    When haven plans the stack's children
    Then it plans one "go" lane running the combined mono-binary subcommand
    And each service is handed its own address variable, not SERVER_ADDR
    And neither a "gateway" lane nor an "nlp" lane is planned

  @unit
  Scenario: A deselected Go service is simply not hosted
    Given a stack that selected the gateway but not the NLP engine
    When haven plans the stack's children
    Then the go lane hosts only the gateway
    And it carries no address for the service that was not selected

  # --- Restarting a lane ---

  @unit
  Scenario: Bouncing the backend lane touches only its own process group
    Given a running stack
    When "haven restart backend" runs
    Then only the process group holding the API port is terminated
    And the ui lane's group is untouched

  # Offering the old names would let someone bounce one service and silently
  # take the other down with it.
  @unit
  Scenario: The Go data-plane services are restarted as one lane
    Given a running stack whose gateway and NLP engine share a process
    When a developer names "gateway" or "nlp" to restart
    Then the command is refused with the restartable list
    And "go" is the name that bounces them

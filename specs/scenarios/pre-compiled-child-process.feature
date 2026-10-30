Feature: Pre-compiled Scenario Child Process

  Scenario child processes are spawned fresh per run, so whatever the child
  loads at module scope is paid on every simulation. Spawning via
  `pnpm exec tsx` compiled TypeScript at runtime on every invocation; the
  pre-compiled bundle removed that.

  Pre-compiling alone did not remove the dominant cost. The bundle kept the
  scenario SDK external, so the child still resolved that package's entire
  dependency graph from disk at boot — thousands of file reads before it could
  read a single byte of job data. Inlining the SDK into the bundle turns that
  graph into one file read.

  Key design decisions:
  - The scenario SDK is INLINED into the bundle. It is the single largest
    startup cost when left external, and the child is a fresh process per run
    so it pays that cost every time.
  - OpenTelemetry stays EXTERNAL, and this is load-bearing rather than
    incidental. The child reaches for the globally registered tracer provider
    to flush spans before exit. Inlining the OTEL API would give the child two
    copies of it — the SDK registering its provider into one, the flush code
    reading the other and finding a no-op proxy — and every span would be
    dropped silently.
  - In development, a current bundle is spawned with node. Otherwise tsx is
    used for fast iteration, but only when it resolves from the child package.
    In production the pre-compiled bundle is required — packaged deployments
    carry no tsx. A missing runtime fails with an install or build remedy
    instead of a pnpm wrapper error.
  - The child is its own app, @langwatch/scenario-child; its bundle lives at
    dist/server/scenario-child-process.cjs relative to that package root
  - The build step is integrated into the existing build pipeline

  Background:
    Given the scenario worker is configured to spawn child processes

  # ---------------------------------------------------------------------------
  # Build Step
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Build step produces a runnable JavaScript bundle
    When the child process build step runs
    Then it produces a single JavaScript file at dist/server/scenario-child-process.cjs

  @integration
  Scenario: Starting a simulation does not re-read its dependencies from disk
    When the child process build step runs
    Then the bundle does not require the scenario SDK from node_modules
    And the SDK's own module graph is not resolved from disk at child startup

  @integration
  Scenario: A simulation still reports its spans
    A second copy of the OTEL API inside the bundle would take the provider
    registration and the span flush to different global registries, and the
    child would report no spans at all while still exiting successfully.

    When the child process build step runs
    Then the bundle requires "@opentelemetry/api" from node_modules
    And no copy of the OpenTelemetry API is inlined into the bundle

  @regression
  Scenario: An inlined dependency binds only exports the external OTEL packages still have
    Inlining the SDK while keeping OpenTelemetry external means the SDK's OTEL
    bindings are resolved against whatever version the application depends on,
    not the one the SDK was published against. When those disagree about an
    export, the child dies at module scope and every simulation fails before it
    starts.

    A missing export is invisible to a check for unresolved modules, and the
    exit code is the same whether the child crashed on load or read its input
    and rejected it. Only a result on stdout distinguishes the two.

    When the child process build step runs
    And a child process is started with input that is not valid job data
    Then the child reports that it could not parse the job data

  @regression
  Scenario: Configuring log output does not stop a simulation starting
    A package that locates a FILE relative to its own directory cannot be
    inlined, because inlining is what moves that directory. The logger is one:
    it runs its transport on a worker thread whose script it finds next to
    itself. Inlined, that lookup missed and the worker rethrew on nextTick —
    an uncaught error, so the transport's own try/catch never saw it and the
    child died instead of degrading. Both ordinary configurations reach it:
    pretty console logs and the telemetry log transport.

    Given a pre-compiled child process bundle
    And the child is configured to write pretty console logs
    When the child process starts
    Then it does not die failing to load its log transport worker

  @integration
  Scenario: The child starts with every dependency it needs
    Given a pre-compiled child process bundle
    When the bundle is loaded from a production-shaped directory layout
    Then no module fails to resolve

  @integration
  Scenario: Installed tsx starts the child source without a bundle
    Given tsx is installed for the scenario child package
    When the child source is started with input that is not valid job data
    Then the child reports that it could not parse the job data

  # ---------------------------------------------------------------------------
  # Spawning — processor uses the compiled bundle
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Processor spawns child process using the pre-compiled bundle in production
    Given a pre-compiled child process bundle exists
    And NODE_ENV is "production"
    When the scenario processor spawns a child process
    Then it invokes "node" with the path to the compiled bundle
    And it does not invoke "pnpm exec tsx"

  @integration
  Scenario: Processor spawns child process using tsx in development
    Given NODE_ENV is "development"
    And the pre-compiled bundle is missing or older than the child source
    And tsx resolves from the scenario child package
    When the scenario processor spawns a child process
    Then it invokes "pnpm exec tsx" with the TypeScript source file

  @integration
  Scenario: Child process receives job data via stdin
    Given a child process spawned from the pre-compiled bundle
    When the processor writes job data to stdin
    Then the child process reads and parses the job data
    And scenario execution proceeds normally

  @unit
  Scenario: Child process environment variables are preserved
    Given a child process spawned from the pre-compiled bundle
    When the processor sets LANGWATCH_API_KEY, LANGWATCH_ENDPOINT, and OTEL_RESOURCE_ATTRIBUTES
    Then the child process receives those environment variables

  # ---------------------------------------------------------------------------
  # Startup Performance
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Pre-compiled child process is ready for job data promptly
    Given a pre-compiled child process bundle
    When a child process is spawned and begins reading from stdin
    Then it is ready to receive job data well inside the startup budget

  @unit
  Scenario: Repeat simulations do not repeat the same startup work
    Re-compiling the bundle's JavaScript on every spawn is wasted work, since
    the bundle only changes when the app is rebuilt.

    Given the scenario processor builds the child environment
    Then the child environment names a compile cache directory
    And a caller-provided cache directory is preserved

  # ---------------------------------------------------------------------------
  # Error Handling
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Processor fails loudly when the bundle is missing in production
    Given the pre-compiled bundle file does not exist at the expected path
    And NODE_ENV is "production"
    When the scenario processor resolves the child process spawn
    Then resolution fails rather than returning a tsx command
    And it logs an error with the missing bundle path and remediation steps

  @unit @regression
  Scenario: Missing tsx fails before spawn when the bundle is missing
    Given the pre-compiled bundle file does not exist at the expected path
    And NODE_ENV is not production
    And tsx does not resolve from the scenario child package
    When the scenario processor resolves the child process spawn
    Then resolution fails before returning a pnpm command
    And the error names the bundle as missing, tsx as unavailable, and the remedies "pnpm install" or "pnpm --filter @langwatch/scenario-child build"
    And the original resolution cause is logged without environment values

  @unit @regression
  Scenario: Missing tsx fails before spawn when the bundle is stale
    Given a pre-compiled bundle older than the child source
    And NODE_ENV is not production
    And tsx does not resolve from the scenario child package
    When the scenario processor resolves the child process spawn
    Then resolution fails before returning a pnpm command
    And the error names the bundle as stale, tsx as unavailable, and the remedies "pnpm install" or "pnpm --filter @langwatch/scenario-child build"

  @unit @regression
  Scenario: A child startup failure is stored on the run
    Given the scenario processor starts a run
    When starting the child process fails with an actionable message
    Then the run is finished as failed with that complete message
    And the failure metric is recorded
    And the execution pool is released

  # Outside production, the fallback returns a tsx command only when tsx
  # resolves from the scenario child package. tsx is a devDependency of
  # @langwatch/scenario-child, so a source checkout that installed dev
  # dependencies can run it. Where it does not resolve, the resolver fails with
  # the install or build remedy instead of handing pnpm a command it cannot
  # run. Production never falls back: the bundle is the only supported
  # packaged-deployment path.

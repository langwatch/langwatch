Feature: Pre-compiled Scenario Child Process

  Scenario child processes are spawned via `pnpm exec tsx`, which compiles
  TypeScript at runtime on every invocation. Cold starts take ~4.5 minutes and
  warm starts ~53 seconds, nearly exhausting the 5-minute timeout before actual
  scenario execution begins.

  Pre-compiling the child process entry point into a single bundled JavaScript
  file eliminates tsx compilation, pnpm resolution, and corepack overhead,
  reducing startup to low single-digit seconds.

  Key design decisions:
  - Shared singleton dependencies (OTEL, scenario SDK) are kept external
    to preserve runtime semantics and avoid double-bundling
  - In development, tsx is used for fast iteration; in production, the
    pre-compiled bundle is required
  - Bundle output lives at dist/scenario-child-process.js relative to
    the langwatch package root
  - The build step is integrated into the existing build pipeline

  Background:
    Given the scenario worker is configured to spawn child processes

  # ---------------------------------------------------------------------------
  # Build Step
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Build step produces a runnable JavaScript bundle
    When the child process build step runs
    Then it produces a single JavaScript file at dist/scenario-child-process.js
    And shared singleton dependencies are excluded from the bundle

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
    When the scenario processor spawns a child process
    Then it invokes "pnpm exec tsx" with the TypeScript source file

  @unit
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
  Scenario: Pre-compiled child process starts within seconds
    Given a pre-compiled child process bundle
    When a child process is spawned and begins reading from stdin
    Then it is ready to receive job data in under 5 seconds

  # ---------------------------------------------------------------------------
  # Error Handling
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Processor falls back to tsx with loud logging when bundle is missing in production
    Given the pre-compiled bundle file does not exist at the expected path
    And NODE_ENV is "production"
    When the scenario processor resolves the child process spawn
    Then it falls back to tsx instead of crashing
    And it logs an error with the missing bundle path and remediation steps

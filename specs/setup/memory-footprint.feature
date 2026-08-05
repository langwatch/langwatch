Feature: Reduced server memory footprint
  As a developer running LangWatch locally
  I want every server process to load only the modules it actually needs
  So that a laptop juggling several worktrees isn't holding megabytes of
     browser UI, cloud SDKs and unused instrumentation it will never call

  # Profiling on 2026-07-21 (Node 24, tsx runtime) measured what a server
  # process actually resident holds. Three things dominated and none of them
  # were load-bearing: the entire browser UI stack, the Google DLP cloud SDK,
  # and the ~41-package OTel auto-instrumentation bundle. Each is addressed
  # below.
  #
  # The process TOPOLOGY — one Node process or two — is a separate concern,
  # specified in specs/setup/in-process-workers-dev.feature and decided in
  # dev/docs/adr/004-docker-dev-environment.md. This feature is about what a
  # process loads, not how many of them run.

  # Two heavy, rarely-needed dependencies are kept out of the boot graph by
  # config, not loaded eagerly. @google-cloud/dlp (generated protos via
  # google-gax/grpc — one of the largest single deps) only loads when a
  # google_dlp PII check actually runs, and never when opted out. The OTel
  # instrumentation packages only load when observability is configured, and
  # then only the handful we actually use (not the ~41-package auto bundle).

  @unit
  Scenario: Google DLP loads its cloud SDK only when enabled and used
    Given a project with no google_dlp PII check running
    When the server boots
    Then the @google-cloud/dlp SDK is not loaded in the process
    When LANGWATCH_DISABLE_GOOGLE_DLP is set and a google_dlp check is requested
    Then the check is refused and the SDK is still never loaded

  # Locally, DLP is off unless a developer deliberately turns it back on: no local
  # workflow should ship trace text to Google, and the opt-out also keeps the SDK
  # out of the process. It stays a default, not a lock — haven emits nothing when
  # the developer opts back in, leaving .env to govern.
  @unit
  Scenario: Local dev opts out of Google DLP by default
    Given a developer starts a stack with haven
    When a google_dlp PII check is requested
    Then the check is refused, so no trace text leaves for Google
    And the @google-cloud/dlp SDK never loads, even with credentials present
    When the developer opts back in to running DLP locally
    Then their own configuration governs the check again

  @unimplemented
  Scenario: OTel instrumentation loads only when observability is configured
    Given neither an OTLP endpoint nor a LangWatch API key is set
    When the server or workers boot
    Then no OpenTelemetry instrumentation package is loaded
    When an OTLP endpoint is configured
    Then only the aws-sdk, openai, pino, runtime-node, and ioredis instrumentations load
    And no instrumentation for frameworks the server doesn't run (express, koa, pg, grpc) is loaded
    And ioredis statements are still truncated to command plus first key, requiring a parent span

  # Every backend process was also holding the entire browser UI stack. A single
  # import edge caused it: `evaluations-legacy.ts` pulled a display-name constant
  # out of a React component, and that one edge dragged in Chakra UI, Ark UI,
  # Emotion, react-dom and react-router — ~1,320 modules of browser-only code
  # resident in the API, worker, and ingestion processes alike. Constants shared
  # by the API and the UI belong beside the evaluator catalog both already
  # import, not inside a component.

  @unimplemented
  Scenario: The backend never loads the browser UI stack
    Given the server boots its app-layer, API router, and tRPC root
    When the loaded module graph is inspected
    Then no Chakra UI, Ark UI, Emotion, react-dom or react-router module is resident
    And evaluator display names still resolve for legacy evaluation responses

  @unit
  Scenario: Server code cannot reach browser-only UI, even transitively
    Given a module under src/server
    When it imports a UI toolkit, or a component that imports one
    Then the boundary guard fails and names the offending import chain
    But a type-only import of a component's types is allowed, since types are erased
    And server-rendered email templates may use React, since emails are React-rendered

  # Separately, a guard closes a footprint-adjacent foot-gun found while
  # profiling `pnpm start`: env-load.ts loads .env with `override: true`, so a
  # stray `NODE_ENV=development` line in a dev machine's .env would silently
  # de-productionize a production boot (API port moves to PORT+1000, no CSP, no
  # static serving) while the process composition stayed prod. NODE_ENV is a
  # runtime mode, not configuration, so it stays shell-only.
  @unit
  Scenario: pnpm start stays in production mode on a machine with a dev .env
    Given .env contains NODE_ENV=development
    When the server boots with NODE_ENV=production in its environment
    Then the process keeps running in production mode
    And a warning explains that NODE_ENV from .env is ignored

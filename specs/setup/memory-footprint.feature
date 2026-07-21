Feature: Reduced local dev memory footprint
  As a developer running LangWatch locally
  I want `pnpm dev` to run one Node server process instead of two
  So that a laptop juggling several worktrees isn't paying for a second full
     copy of the server module graph

  # Profiling on 2026-07-21 (Node 24, tsx runtime) showed that plain `pnpm dev`
  # ran the app and the background workers as TWO Node processes, each of which
  # loads the entire server module graph — ~500 MB resident apiece. The worker
  # process is a second full copy: same imports, same app-layer wiring. Hosting
  # the workers inside the app process (the "all" role, already used under
  # haven and via `pnpm dev:single`) removes that duplication with no loss of
  # background-job behavior. This only flips the DEFAULT; the two-process
  # topology stays one env var away.
  #
  # See specs/setup/in-process-workers-dev.feature for the WORKERS_IN_PROCESS
  # flag mechanics this builds on, and dev/docs/adr/004-docker-dev-environment.md.

  Scenario: Plain pnpm dev runs one Node server process by default
    Given a developer runs `pnpm dev` without setting WORKERS_IN_PROCESS
    When the stack boots
    Then the background workers run inside the app process
    And no separate workers process is started
    And background jobs are processed normally

  Scenario: Opting back into the two-process topology
    Given a developer wants the app and workers as separate processes
    When they run `pnpm dev:workers` (or set WORKERS_IN_PROCESS=0)
    Then the workers run as their own process, as before

  Scenario: The single-process default is development-only
    Given the server boots with NODE_ENV=production
    When the stack starts
    Then the WORKERS_IN_PROCESS default is not applied
    And web and workers remain separate deployments

  # Two heavy, rarely-needed dependencies are kept out of the boot graph by
  # config, not loaded eagerly. @google-cloud/dlp (generated protos via
  # google-gax/grpc — one of the largest single deps) only loads when a
  # google_dlp PII check actually runs, and never when opted out. The OTel
  # instrumentation packages only load when observability is configured, and
  # then only the handful we actually use (not the ~41-package auto bundle).

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
  Scenario: Local dev opts out of Google DLP by default
    Given a developer starts a stack with haven
    When the environment overlay is written
    Then Google DLP is disabled for that stack
    And the @google-cloud/dlp SDK never loads, even with credentials present
    When the developer sets LANGWATCH_DISABLE_GOOGLE_DLP to false
    Then haven leaves the setting to .env, so DLP can be exercised locally

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

  Scenario: The backend never loads the browser UI stack
    Given the server boots its app-layer, API router, and tRPC root
    When the loaded module graph is inspected
    Then no Chakra UI, Ark UI, Emotion, react-dom or react-router module is resident
    And evaluator display names still resolve for legacy evaluation responses

  Scenario: Server code cannot reach browser-only UI, even transitively
    Given a module under src/server
    When it imports a UI toolkit, or a component that imports one
    Then the boundary guard fails and names the offending import chain
    But a type-only import of a component's types is allowed, since types are erased
    And server-rendered email templates may use React, since emails are React-rendered

  # Separately, a guard closes a footprint-adjacent foot-gun found while
  # profiling `pnpm start`: server.mts loads .env with `override: true`, so a
  # stray `NODE_ENV=development` line in a dev machine's .env would silently
  # de-productionize a production boot (API port moves to PORT+1000, no CSP, no
  # static serving) while the process composition stayed prod. NODE_ENV is a
  # runtime mode, not configuration, so it stays shell-only.
  Scenario: pnpm start stays in production mode on a machine with a dev .env
    Given .env contains NODE_ENV=development
    When the server boots with NODE_ENV=production in its environment
    Then the process keeps running in production mode
    And a warning explains that NODE_ENV from .env is ignored

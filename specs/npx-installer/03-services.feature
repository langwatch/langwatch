Feature: Service orchestration after pre-deps are installed
  As a user who just ran `npx @langwatch/server`
  I want every LangWatch service started, healthy, and pointing at fresh credentials
  So that I can hit http://localhost:5560 and start using the product

  See _shared/contract.md §4–§8 for paths, ports, secrets, supervision rules.

  Background:
    Given pre-dependencies (uv, postgres, redis, clickhouse, ai-gateway) are installed under "~/.langwatch/bin/"
    And every port in the services-tier (5560..5563) and infra-tier (6560..6563) is free

  # =========================================================================
  # .env scaffolding
  # =========================================================================

  Scenario: First run generates a fresh .env with random secrets
    Given "~/.langwatch/.env" does not exist
    When the CLI calls `runtime.scaffoldEnv(ctx)`
    Then "~/.langwatch/.env" exists with mode 0600
    And it contains a "NEXTAUTH_SECRET" value of 44 base64 chars
    And it contains a "CREDENTIALS_SECRET" value of 64 hex chars
    And it contains a "LW_GATEWAY_INTERNAL_SECRET" value of 64 hex chars
    And it contains a "LW_GATEWAY_JWT_SECRET" value of 64 hex chars
    And it contains a "LW_VIRTUAL_KEY_PEPPER" value of 64 hex chars
    And it contains a "API_TOKEN_JWT_SECRET" value of 64 hex chars
    And it contains "BASE_HOST=http://localhost:5560"
    And it contains "PORT=5560"
    And it contains "DATABASE_URL=postgresql://langwatch@localhost:6560/langwatch_db?schema=langwatch_db&connection_limit=5"
    And it contains "CLICKHOUSE_URL=http://localhost:6562/langwatch"
    And it contains "REDIS_URL=redis://localhost:6561/0"

  Scenario: Re-running preserves existing secrets
    Given "~/.langwatch/.env" exists with "NEXTAUTH_SECRET=existing_value_xyz"
    When the CLI calls `runtime.scaffoldEnv(ctx)`
    Then the call returns { written: false, path: "~/.langwatch/.env" }
    And "~/.langwatch/.env" still contains "NEXTAUTH_SECRET=existing_value_xyz"
    And no secret is regenerated

  Scenario: User-provided OPENAI_API_KEY is propagated, not persisted
    Given the user has "OPENAI_API_KEY=sk-real-key-123" in their shell env
    When the CLI starts services
    Then the langwatch_nlp child process has "OPENAI_API_KEY=sk-real-key-123" in its env
    But "~/.langwatch/.env" contains an empty "OPENAI_API_KEY=" line, not the user's value

  Scenario: Generated secrets are unique per install
    Given two separate machines each run `npx @langwatch/server` for the first time
    Then their "CREDENTIALS_SECRET" values differ
    And their "LW_GATEWAY_INTERNAL_SECRET" values differ

  # =========================================================================
  # Service startup order + health
  # =========================================================================

  Scenario: Services start in dependency order and report healthy
    When the CLI calls `runtime.startAll(ctx)`
    Then "postgres", "redis", "clickhouse" start concurrently in phase 1
    And "pg_isready -p 6560" returns 0 within 10 seconds
    And "redis-cli -p 6561 ping" returns "PONG" within 5 seconds
    And "curl http://localhost:6562/ping" returns "Ok." within 30 seconds
    And in phase 2, Prisma migrations run against postgres and ClickHouse goose runs against clickhouse
    And in phase 3, "langwatch_nlp", "langevals", "ai-gateway", "langwatch" start concurrently
    And "curl http://localhost:5561/health" returns 200 within 30 seconds
    And "curl http://localhost:5562/health" returns 200 within 30 seconds
    And "curl http://localhost:5563/healthz" returns 200 within 10 seconds
    And "curl http://localhost:5560/api/health" returns 200 within 60 seconds
    And `runtime.startAll` returns one ServiceHandle per service

  Scenario: Migrations run automatically on first start
    Given postgres has no "langwatch_db" schema yet
    And clickhouse has no "langwatch" database yet
    When phase 2 of `runtime.startAll(ctx)` runs
    Then Prisma migrations run and the "Project" table exists in postgres
    And ClickHouse goose runs and the "Trace" table exists in clickhouse

  Scenario: Re-running with healthy data does not re-migrate
    Given postgres + clickhouse already have current migration state
    When `runtime.startAll(ctx)` runs phase 2
    Then Prisma reports "Already in sync"
    And ClickHouse goose reports "no migrations to run"

  # =========================================================================
  # Logs + event stream
  # =========================================================================

  Scenario: Every service log lands in ~/.langwatch/logs and via the event stream
    When services run for 30 seconds
    Then "~/.langwatch/logs/postgres.log" is being written to
    And "~/.langwatch/logs/langwatch.log" is being written to
    And `runtime.events(ctx)` emits "log" events with "service" ∈ {postgres, redis, clickhouse, langwatch_nlp, langevals, ai-gateway, langwatch}
    And the CLI renders each log line to TTY with a stable prefix+color (langwatch=green, nlp=cyan, langevals=magenta, gateway=yellow, postgres=blue, redis=red, clickhouse=dim)

  Scenario: A crashing service emits a "crashed" event and the CLI tears down
    Given all services are running
    When "redis" exits with code 137
    Then `runtime.events(ctx)` emits { type: "crashed", service: "redis", code: 137 }
    And the CLI prints "redis exited unexpectedly (code 137) — see ~/.langwatch/logs/redis.log"
    And the CLI calls `runtime.stopAll(handles)` to bring down everything else
    And the CLI exits with code 1

  Scenario: Ctrl+C cleanly stops every service
    Given all services are running
    When the user sends SIGINT to the CLI process
    Then `runtime.stopAll(handles)` is invoked
    And every handle's `stop()` is called in reverse start order
    And services that don't exit within 10 seconds receive SIGKILL
    And "~/.langwatch/run/<service>.pid" files are removed
    And the CLI exits with code 0

  # =========================================================================
  # Port-conflict handoff (smith handles detection; this verifies the runner honors it)
  # =========================================================================

  Scenario: Runner honors a shifted port-base passed by the predep installer
    Given another process is already listening on 5560
    And the predep installer resolves "port-base=5570" (services tier 5570..5577, infra tier 6570..6573)
    When `runtime.startAll(ctx)` runs
    Then "BASE_HOST" in the running app's env is "http://localhost:5570"
    And the langwatch app binds 5570
    And langwatch_nlp binds 5571, langevals 5572, ai-gateway 5573
    And postgres binds 6570, redis 6571, clickhouse-http 6572, clickhouse-native 6573
    And the browser auto-open targets "http://localhost:5570"

  Scenario: Explicit --port flag wins over auto-shift
    When the user runs `npx @langwatch/server --port 6660`
    Then port-base is 6660
    And no auto-shift occurs even if 6660 is in use (instead, the CLI errors loudly)

  # =========================================================================
  # Browser auto-open
  # =========================================================================

  Scenario Outline: Auto-open uses platform-correct command
    Given the OS is "<os>"
    When all services are healthy
    Then the CLI executes "<open-cmd> http://localhost:5560"

    Examples:
      | os    | open-cmd  |
      | macos | open      |
      | linux | xdg-open  |

  Scenario: --no-open suppresses the browser
    When the user runs `npx @langwatch/server --no-open`
    Then no browser is launched
    And the CLI prints "Open http://localhost:5560 in your browser to get started."

  Scenario: CI env auto-suppresses the browser
    Given the env var "CI=true" is set
    When all services are healthy
    Then no browser is launched

  # =========================================================================
  # uv environments for langwatch_nlp + langevals (runtime.installServices)
  # =========================================================================

  Scenario: Both uv envs install in parallel on first run
    Given "~/.langwatch/venvs/langwatch_nlp" does not exist
    And "~/.langwatch/venvs/langevals" does not exist
    When the CLI calls `runtime.installServices(ctx)`
    Then "uv sync" is invoked for both projects concurrently
    And both venvs exist within 90 seconds (warm pip cache acceptable)
    And `runtime.events(ctx)` emits a "starting" + "healthy" pair for "uv:langwatch_nlp" and "uv:langevals"

  Scenario: uv envs are cached across runs
    Given both venvs already exist with current lockfile hash recorded in install-manifest.json
    When the CLI calls `runtime.installServices(ctx)`
    Then "uv sync" is NOT re-run
    And the call completes in under 1 second

  Scenario: Lockfile change forces a re-sync of only the affected venv
    Given "langwatch_nlp/uv.lock" hash changed since last run
    And "langevals/uv.lock" hash is unchanged
    When the CLI calls `runtime.installServices(ctx)`
    Then "uv sync" runs ONLY for "langwatch_nlp"
    And "langevals" is skipped

  # =========================================================================
  # Re-entrancy guard
  # =========================================================================

  Scenario: Second concurrent invocation refuses to start
    Given a `npx @langwatch/server` is already running with pid 5555
    And "~/.langwatch/run/langwatch.pid" contains "5555"
    When a second `npx @langwatch/server` is invoked
    Then it prints "LangWatch is already running (pid 5555). Stop it with Ctrl+C in that terminal, or run `npx @langwatch/server doctor` to inspect."
    And it exits with code 1

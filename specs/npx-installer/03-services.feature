Feature: Service orchestration after pre-deps are installed
  As a user who just ran `npx @langwatch/server`
  I want every LangWatch service started, healthy, and pointing at fresh credentials
  So that I can hit http://localhost:5560 and start using the product

  See _shared/contract.md §4–§8 for paths, ports, secrets, supervision rules.

  Background:
    Given pre-dependencies (uv, postgres, redis, clickhouse, go-gateway) are installed at "~/.langwatch/"
    And no other process is bound to the default ports 5560..5563, 6032, 6379, 8123

  # =========================================================================
  # .env scaffolding
  # =========================================================================

  Scenario: First run generates a fresh .env with random secrets
    Given "~/.langwatch/langwatch.env" does not exist
    When the CLI completes the env-scaffold step
    Then "~/.langwatch/langwatch.env" exists with mode 0600
    And it contains a "NEXTAUTH_SECRET" value of 44 base64 chars
    And it contains a "CREDENTIALS_SECRET" value of 64 hex chars
    And it contains a "LW_GATEWAY_INTERNAL_SECRET" value of 64 hex chars
    And it contains a "LW_GATEWAY_JWT_SECRET" value of 64 hex chars
    And it contains a "LW_VIRTUAL_KEY_PEPPER" value of 64 hex chars
    And it contains a "API_TOKEN_JWT_SECRET" value of 64 hex chars
    And it contains "BASE_HOST=http://localhost:5560"
    And it contains "DATABASE_URL=postgresql://langwatch:langwatch@localhost:6032/langwatch?schema=langwatch_db"
    And it contains "CLICKHOUSE_URL=http://default:langwatch@localhost:8123/langwatch"
    And it contains "REDIS_URL=redis://localhost:6379"

  Scenario: Re-running preserves existing secrets
    Given "~/.langwatch/langwatch.env" exists with "NEXTAUTH_SECRET=existing_value_xyz"
    When the CLI completes the env-scaffold step
    Then "~/.langwatch/langwatch.env" still contains "NEXTAUTH_SECRET=existing_value_xyz"
    And no secret is regenerated

  Scenario: User-provided OPENAI_API_KEY is propagated, not persisted
    Given the user has "OPENAI_API_KEY=sk-real-key-123" in their shell env
    When the CLI starts services
    Then the langwatch_nlp child process has "OPENAI_API_KEY=sk-real-key-123" in its env
    But "~/.langwatch/langwatch.env" does NOT contain "OPENAI_API_KEY"

  Scenario: Generated secrets are unique per install
    Given two separate machines each run `npx @langwatch/server` for the first time
    Then their "CREDENTIALS_SECRET" values differ
    And their "LW_GATEWAY_INTERNAL_SECRET" values differ

  # =========================================================================
  # Service startup order + health
  # =========================================================================

  Scenario: Services start in dependency order and report healthy
    When the CLI runs the supervision phase
    Then "postgres" starts first and "pg_isready" returns 0 within 10 seconds
    And "redis" starts and "redis-cli ping" returns "PONG" within 5 seconds
    And "clickhouse" starts and "curl http://localhost:8123/ping" returns "Ok." within 30 seconds
    And "langwatch_nlp" starts after postgres+redis+clickhouse and "curl http://localhost:5561/health" returns 200 within 30 seconds
    And "langevals" starts after postgres+redis+clickhouse and "curl http://localhost:5562/health" returns 200 within 30 seconds
    And "ai-gateway" starts after postgres+redis and "curl http://localhost:5563/healthz" returns 200 within 10 seconds
    And "langwatch" (control plane) starts last and "curl http://localhost:5560/api/health" returns 200 within 60 seconds

  Scenario: Migrations run automatically on first start
    Given postgres has no "langwatch" schema yet
    And clickhouse has no "langwatch" database yet
    When "langwatch" boots
    Then Prisma migrations run and the "Project" table exists in postgres
    And ClickHouse migrations run and the "Trace" table exists in clickhouse

  Scenario: Re-running with healthy data does not re-migrate
    Given postgres + clickhouse already have current migration state
    When "langwatch" boots
    Then Prisma reports "Already in sync"
    And ClickHouse goose reports "no migrations to run"

  # =========================================================================
  # Logs
  # =========================================================================

  Scenario: Every service log lands in ~/.langwatch/logs and the TTY
    When services run for 30 seconds
    Then "~/.langwatch/logs/<today>/postgres.log" is written
    And "~/.langwatch/logs/<today>/langwatch.log" is written
    And the user's TTY shows interleaved lines prefixed with "[langwatch]", "[nlp]", "[langevals]", "[gateway]", "[postgres]", "[redis]", "[clickhouse]"
    And each prefix has a stable color (langwatch=green, nlp=cyan, langevals=magenta, gateway=yellow, infra=dim)

  Scenario: A crashing service kills the whole process group
    Given all services are running
    When "redis" exits with code 137
    Then the CLI prints "redis exited unexpectedly (code 137) — see ~/.langwatch/logs/<today>/redis.log"
    And every other service receives SIGTERM within 1 second
    And the CLI exits with code 1

  Scenario: Ctrl+C cleanly stops every service
    Given all services are running
    When the user sends SIGINT to the CLI process
    Then every supervised service receives SIGTERM
    And services that don't exit within 10 seconds receive SIGKILL
    And "~/.langwatch/pids/" is empty after exit
    And the CLI exits with code 0

  # =========================================================================
  # Port-conflict handoff (smith handles detection; this verifies the runner honors it)
  # =========================================================================

  Scenario: Runner honors a shifted port-base passed by the predep installer
    Given another process is already listening on 5560
    And the predep installer resolves "port-base=5570"
    When services start
    Then "BASE_HOST" in the running app's env is "http://localhost:5570"
    And the langwatch app binds 5570
    And "langwatch_nlp" binds 5571
    And "langevals" binds 5572
    And "ai-gateway" binds 5573
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
  # uv environments for langwatch_nlp + langevals
  # =========================================================================

  Scenario: Both uv envs install in parallel on first run
    Given "~/.langwatch/venvs/langwatch_nlp" does not exist
    And "~/.langwatch/venvs/langevals" does not exist
    When the CLI runs the service-deps step
    Then "uv sync" is invoked for both projects concurrently
    And both venvs exist within 90 seconds (warm pip cache acceptable)

  Scenario: uv envs are cached across runs
    Given both venvs already exist with current lockfile hash in "<venv>/.lock-hash"
    When the CLI runs the service-deps step
    Then "uv sync" is NOT re-run
    And the step completes in under 1 second

  Scenario: Lockfile change forces a re-sync of only the affected venv
    Given "langwatch_nlp/uv.lock" hash changed since last run
    And "langevals/uv.lock" hash is unchanged
    When the CLI runs the service-deps step
    Then "uv sync" runs ONLY for "langwatch_nlp"
    And "langevals" is skipped

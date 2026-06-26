Feature: make quickstart is the single dev environment entry point with intent-based modes
  As a developer working on LangWatch
  I want one command that asks what I'm working on, starts only the services I need, and overrides only the URLs whose services are local
  So that my .env stays the source of truth and I don't lose state across worktrees

  # Behavior is in `compose.dev.yml` + `compose.dev.migration.yml` (volume
  # names + env_file overlay + host port overlay), `Makefile` (deprecation
  # wrappers + positional MODE arg pass-through), and `scripts/dev.sh`
  # (intent-based prompt + write_overrides + fail-fast + collision detection).
  # The `write_overrides` URL rewrite scenarios are bound to
  # `scripts/__tests__/dev-overrides.unit.bats`. End-to-end shell+docker
  # scenarios (intent prompt UX, idempotency, cross-worktree volume sharing,
  # singleton redis, deprecation warnings) remain `@unimplemented` until a
  # docker-aware integration suite exists.

  # --- Single entry point (#3860 AC#1) ---

  @unit @unimplemented
  Scenario: make help points at quickstart as the single entry point
    When I run "make help"
    Then the output describes "make quickstart" as the interactive launcher
    And the output marks "make dev" / "make dev-up" as deprecated

  @unit @unimplemented
  Scenario: make dev prints a deprecation warning before running
    When I run "make dev"
    Then a warning on stderr points at "make quickstart"
    And the underlying mode runs (one release of grace)

  # --- Intent-based prompting (#3860 AC#2) ---

  @unit @unimplemented
  Scenario: quickstart asks "what are you working on?" with five intent-based modes
    When I run "make quickstart" with no arguments
    Then the prompt lists modes: frontend-only, all-local, migration, nlp, full-local
    And each mode has a one-line description of what services start and what URLs are rewritten

  @unit @unimplemented
  Scenario: make quickstart accepts a positional mode arg for non-interactive runs
    When I run "make quickstart frontend-only"
    Then dev.sh runs in frontend-only mode without prompting

  @unit @unimplemented
  Scenario: make quickstart-help prints the mode reference
    When I run "make quickstart-help"
    Then the output lists each of the five modes with services + URL overrides
    And it does not require interactive input

  # --- Default = fastest path (#3860 AC#3) ---

  @unit
  Scenario: frontend-only pins host-side Redis for in-process workers, no other compose
    When write_overrides is called with mode=frontend-only
    Then langwatch/.env.dev-up contains NEXTAUTH_PROVIDER=email
    And REDIS_URL pointing at localhost:6379 (for the in-process BullMQ workers)
    And it does NOT override DATABASE_URL, CLICKHOUSE_URL, or LANGWATCH_NLP_SERVICE

  @integration @unimplemented
  Scenario: frontend-only mode is fast — under 5 seconds to ready hint
    When I run "make quickstart frontend-only"
    Then the command completes in under 5 seconds with a hint to run "pnpm dev"

  # --- Host-Redis verification before reuse (#5143, CodeRabbit 4579126710) ---
  # frontend-only runs the BullMQ workers in-process under `pnpm dev`, so it
  # needs a usable local Redis on host :6379. A bare port-in-use check is not
  # enough — the listener might be a non-Redis process or a Redis that needs
  # auth/TLS. dev.sh verifies the listener with `redis-cli ... ping` (PONG)
  # before reusing it, errors out when :6379 is occupied by something
  # unverifiable, and only starts its own container when the port is free.
  # Bound to `scripts/__tests__/dev-redis-detection.unit.bats`.

  @unit
  Scenario: redis-cli PONG reply means the listener is a usable local Redis
    Given redis-cli is on PATH and the listener on 6379 replies PONG to ping
    When redis_listener_is_usable runs
    Then it succeeds (the listener is treated as a usable local Redis)

  @unit
  Scenario: a listener that does not reply PONG is not a usable Redis
    Given a listener on 6379 that replies with something other than PONG
    When redis_listener_is_usable runs
    Then it fails (the listener is not treated as a usable Redis)

  @unit
  Scenario: absent redis-cli degrades gracefully to not-usable (no crash)
    Given redis-cli is not on PATH
    When redis_listener_is_usable runs
    Then it fails without crashing (the listener cannot be verified)

  @unit
  Scenario: frontend-only reuses a verified usable Redis without starting a container
    Given host port 6379 is in use and the listener verifies as a usable Redis
    When run_frontend_only runs
    Then it reuses the existing Redis for the in-process workers
    And it does not start a redis compose container

  @unit
  Scenario: frontend-only errors out when 6379 is occupied by an unusable listener
    Given host port 6379 is in use but the listener does not verify as a usable Redis
    When run_frontend_only runs
    Then it errors out with a non-zero exit
    And it does not start a redis compose container

  @unit
  Scenario: frontend-only starts its own redis container when 6379 is free
    Given host port 6379 is free
    When run_frontend_only runs
    Then it starts its own redis compose container for the in-process workers

  # --- URL rewrite per mode (#3860 AC#6) ---

  @unit
  Scenario: all-local overrides only DATABASE_URL, REDIS_URL, CLICKHOUSE_URL
    When write_overrides is called with mode=all-local
    Then langwatch/.env.dev-up contains DATABASE_URL pointing at postgres:5432
    And REDIS_URL pointing at redis:6379
    And CLICKHOUSE_URL pointing at clickhouse:8123
    And it does NOT contain LANGWATCH_NLP_SERVICE or LANGEVALS_ENDPOINT

  @unit
  Scenario: migration uses localhost host-port URLs for prisma migrate from host
    When write_overrides is called with mode=migration
    Then DATABASE_URL points at localhost:5432
    And CLICKHOUSE_URL points at localhost:8123
    And REDIS_URL is not overridden

  @unit
  Scenario: all-local-nlp adds LANGWATCH_NLP_SERVICE and LANGEVALS_ENDPOINT on top of all-local
    When write_overrides is called with mode=all-local-nlp
    Then LANGWATCH_NLP_SERVICE points at langwatch_nlp:5561
    And LANGEVALS_ENDPOINT points at langevals:5562
    And the three backend URLs are also overridden

  @unit
  Scenario: full-local overrides every infrastructure URL
    When write_overrides is called with mode=full-local
    Then all five URLs (DATABASE_URL, REDIS_URL, CLICKHOUSE_URL, LANGWATCH_NLP_SERVICE, LANGEVALS_ENDPOINT) are present

  @unit @unimplemented
  Scenario: contributor's .env is the source of truth for non-overridden values
    Given langwatch/.env defines OPENAI_API_KEY and LANGWATCH_NLP_SERVICE
    When I run "make quickstart all-local"
    Then OPENAI_API_KEY in the running container is the value from .env
    And LANGWATCH_NLP_SERVICE is the value from .env (no override for this mode)

  @unit
  Scenario: write_overrides replaces langwatch/.env.dev-up — does not append
    Given a previous run wrote all-local overrides
    When write_overrides runs again with mode=frontend-only
    Then langwatch/.env.dev-up no longer contains DATABASE_URL
    And it contains the frontend-only overrides NEXTAUTH_PROVIDER and REDIS_URL pointing at localhost:6379
    And the previous all-local REDIS_URL (redis:6379) was replaced, not appended

  # --- Stateful volume sharing (#3860 AC#4) ---

  @integration @unimplemented
  Scenario: postgres volume is shared across worktrees
    Given two worktrees of the langwatch repo
    When worktree A runs "make quickstart all-local" and signs up a user
    And worktree A stops with "make down"
    And worktree B runs "make quickstart all-local"
    Then the user signed up in worktree A is present in worktree B

  @integration @unimplemented
  Scenario: simultaneous postgres up across worktrees is detected
    Given worktree A has postgres up via "make quickstart all-local"
    When worktree B runs "make quickstart all-local"
    Then quickstart errors with a clear message naming the colliding compose project
    And exits non-zero

  # --- Singleton stateless services (#3860 AC#5) ---

  @integration @unimplemented
  Scenario: redis is a singleton on host port 6379
    Given the dev environment is up
    Then a single redis container is running with host port 6379 mapped
    And the volume name is "langwatch-redis-data"

  @integration @unimplemented
  Scenario: starting a second worktree reuses the existing redis
    Given worktree A has the dev environment up
    When worktree B runs "make quickstart all-local"
    Then no second redis container is started
    And worktree B reuses worktree A's redis on host :6379

  # --- Fail-fast + idempotency (#3860 AC#7) ---

  @unit @unimplemented
  Scenario: quickstart errors when langwatch/.env has IS_SAAS=true with BLOCK_LOCAL_HTTP_CALLS=false
    Given langwatch/.env contains IS_SAAS=true and BLOCK_LOCAL_HTTP_CALLS=false
    When I run "make quickstart all-local"
    Then quickstart exits non-zero with a SSRF-guard error message

  @integration @unimplemented
  Scenario: quickstart is idempotent
    Given the dev environment is already up
    When I run "make quickstart" with the same mode again
    Then no new containers are created for already-running services
    And existing containers are not duplicated

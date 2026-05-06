Feature: make quickstart is the single dev environment entry point
  As a developer working on LangWatch
  I want one command to start dev with shared stateful data and a singleton redis
  So that I don't lose my sign-up across worktrees and don't burn time on per-worktree containers

  # Behavior is in `compose.dev.yml` (volume names + redis port), `Makefile`
  # (deprecation wrappers), and `scripts/dev.sh` (help mode + fail-fast +
  # collision detection). No JS-side tests cover these — they are shell /
  # docker config behaviors. Scenarios stay `@unimplemented` for parity
  # tracking; verified by hand and (for the bash slug + rewrite logic of
  # boxd-fork) by `scripts/__tests__/boxd-fork.*.bats`.

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
    And the underlying compose flow still runs (one release of grace)

  # --- Non-interactive mode reference (#3860 AC#8) ---

  @unit @unimplemented
  Scenario: make quickstart-help prints the mode list
    When I run "make quickstart-help"
    Then the output lists modes "dev", "dev-nlp", "dev-scenarios", "dev-test", "dev-full"
    And it explains shared stateful volumes
    And it does not require interactive input

  # --- Stateful volume sharing (#3860 AC#4) ---

  @integration @unimplemented
  Scenario: postgres volume is shared across worktrees
    Given two worktrees of the langwatch repo
    When worktree A runs "make quickstart" and signs up a user
    And worktree A stops with "make down"
    And worktree B runs "make quickstart"
    Then the user signed up in worktree A is present in worktree B

  @integration @unimplemented
  Scenario: simultaneous postgres up across worktrees is detected
    Given worktree A has postgres up via "make quickstart"
    When worktree B runs "make quickstart"
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
    When worktree B runs "make quickstart"
    Then no second redis container is started
    And worktree B reuses worktree A's redis on host :6379

  # --- Fail-fast + idempotency (#3860 AC#7) ---

  @unit @unimplemented
  Scenario: quickstart errors when langwatch/.env has IS_SAAS=true with BLOCK_LOCAL_HTTP_CALLS=false
    Given langwatch/.env contains IS_SAAS=true and BLOCK_LOCAL_HTTP_CALLS=false
    When I run "make quickstart"
    Then quickstart exits non-zero with a SSRF-guard error message

  @integration @unimplemented
  Scenario: quickstart is idempotent
    Given the dev environment is already up
    When I run "make quickstart" with the same mode again
    Then no new containers are created for already-running services
    And existing containers are not duplicated

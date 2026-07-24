Feature: haven lifecycle usability
  Day-to-day up/down/restart ergonomics: down never silently discards data,
  a doubly-started worktree is refused instead of fought over, one service can
  be bounced without tearing the stack down, and stale databases are reclaimed
  in the background instead of at teardown time.

  Background:
    Given a worktree with a registered haven stack

  Scenario: Down keeps the databases by default
    Given the stack's launcher is running
    When the developer runs "haven down"
    Then the launcher is stopped and the routes and registry entry are removed
    And the stack's ClickHouse and Postgres databases still exist

  Scenario: Down drops the databases only when explicitly asked
    When the developer runs "haven down --drop-db"
    Then the stack's ClickHouse and Postgres databases are dropped

  Scenario: The daemon prunes databases idle past the TTL
    Given a slug whose databases were last used longer ago than the idle TTL
    And no stack is registered for that slug
    When the daemon runs its background hygiene
    Then that slug's ClickHouse and Postgres databases are dropped
    And the protected main database is never dropped
    And a slug with a registered stack is never pruned

  Scenario: Up refuses a worktree whose stack is already running
    Given the stack's launcher is running
    When the developer runs "haven up" in the same worktree
    Then it refuses and points at restart, down, and --force

  Scenario: Up --force replaces the running stack
    Given the stack's launcher is running
    When the developer runs "haven up --force"
    Then the old launcher is terminated and waited on before the new stack provisions

  Scenario: Restarting one service bounces only that service
    Given the stack's launcher is running
    When the developer runs "haven restart nlp"
    Then only the nlp service's process group is terminated
    And the supervisor restarts it

  Scenario: Restarting with no service named bounces every supervised child
    When the developer runs "haven restart"
    Then every locally-run service is bounced
    And baseline fallbacks and the shared database servers are untouched

  Scenario: A detached up streams to a log file
    When the developer runs "haven up -d"
    Then the stack starts in the background
    And "haven logs -f" follows its output
    And "haven down" stops it

  Scenario: Switching to a worktree by name
    Given shell integration from "haven shell-init" is installed
    When the developer runs "haven switch" with a unique name prefix
    Then the shell changes directory to that worktree

Feature: haven lifecycle usability
  Day-to-day up/down/restart ergonomics: down never discards data, up on an
  already-running stack reconciles instead of refusing, one service can be
  bounced without tearing the stack down, and stale databases are reclaimed
  in the background instead of at teardown time. The full v2 surface is
  specced in haven-cli-surface.feature (ADR-064).

  Background:
    Given a worktree with a registered haven stack

  Scenario: Down keeps the databases, always
    Given the stack's launcher is running
    When the developer runs "haven down"
    Then the launcher is stopped and the routes and registry entry are removed
    And the stack's ClickHouse and Postgres databases still exist
    And no flag on down can drop them — fresh data is "haven db reset"

  Scenario: The daemon prunes databases idle past the TTL
    Given a slug whose databases were last used longer ago than the idle TTL
    And no stack is registered for that slug
    When the daemon runs its background hygiene
    Then that slug's ClickHouse and Postgres databases are dropped
    And the protected main database is never dropped
    And a slug with a registered stack is never pruned

  Scenario: Up on an already-running stack reconciles
    Given the stack's launcher is running
    When the developer runs "haven up" in the same worktree
    Then a matching selection is a friendly no-op and the stack is left in place
    And a changed selection replaces the stack in place with the new one
    And there is no refusal and no force flag

  Scenario: Restarting one service bounces only that service
    Given the stack's launcher is running
    When the developer runs "haven restart nlp"
    Then only the nlp service's process group is terminated
    And the supervisor restarts it

  Scenario: Restarting with no service named bounces every supervised child
    When the developer runs "haven restart"
    Then every locally-run service is bounced
    And baseline fallbacks and the shared database servers are untouched

  Scenario: A detached up logs the same as an attached one
    When the developer runs "haven up --detach"
    Then the stack starts in the background
    And "haven logs -f" follows it exactly as it would an attached stack
    And "haven down" stops it

  Scenario: Switching to a worktree by name
    Given shell integration from "haven shell-init" is installed
    When the developer runs "haven switch" with a unique name prefix
    Then the shell changes directory to that worktree

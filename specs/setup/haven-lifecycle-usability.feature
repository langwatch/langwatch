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

  @unit
  Scenario: Down -f kills hard
    Given the stack's launcher is running
    When the developer runs "haven down -f"
    Then the launcher's process group is SIGKILLed with no graceful wait
    And the databases still exist

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
    And "haven up -f" restarts even a matching stack
    And there is never a refusal

  Scenario: Restarting one service bounces only that service
    Given the stack's launcher is running
    When the developer runs "haven restart nlp"
    Then only the nlp service's process group is terminated
    And the supervisor restarts it

  Scenario: Restarting with no service named bounces every supervised child
    When the developer runs "haven restart"
    Then every locally-run service is bounced
    And baseline fallbacks and the shared database servers are untouched

  @unit
  Scenario: Up in a terminal never holds the stack hostage
    When the developer runs "haven up" in a terminal
    Then the stack runs in the background and an interactive log view attaches
    And quitting the view (q, esc, or Ctrl-C) detaches — the stack keeps running
    And "haven down" is what stops it

  @unit
  Scenario: Switching between service log groups is a keypress
    Given the attached log view is open
    Then arrow keys, tab, or a digit switch between "all" and each service's own log
    And the lines are coloured by service with warnings and errors highlighted

  Scenario: A piped up streams in the foreground
    When "haven up" runs with output piped (pnpm dev:haven | tee)
    Then it streams plainly in the foreground and Ctrl-C stops the stack

  Scenario: A detached up logs the same as an attached one
    When the developer runs "haven up --detach"
    Then the stack starts in the background
    And "haven logs -t" follows it exactly as it would an attached stack
    And "haven down" stops it

  Scenario: Switching to a worktree by name
    Given shell integration from "haven shell-init" is installed
    When the developer runs "haven switch" with a unique name prefix
    Then the shell changes directory to that worktree

Feature: haven lifecycle usability
  Day-to-day up/down/restart ergonomics: down never discards data, up on an
  already-running stack reconciles instead of refusing, one service can be
  bounced without tearing the stack down, and stale databases are reclaimed
  in the background instead of at teardown time. The full v2 surface is
  specced in haven-cli-surface.feature (ADR-064).

  Background:
    Given a worktree with a registered haven stack

  @unit
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

  @unit
  Scenario: The daemon prunes databases idle past the TTL
    Given a slug whose databases were last used longer ago than the idle TTL
    And no stack is registered for that slug
    When the daemon runs its background hygiene
    Then that slug's ClickHouse and Postgres databases are dropped
    And the protected main database is never dropped
    And a slug with a registered stack is never pruned

  @unit
  Scenario: Up on an already-running stack reconciles
    Given the stack's launcher is running
    When the developer runs "haven up" in the same worktree
    Then a matching selection is a friendly no-op and the stack is left in place
    And a changed selection replaces the stack in place with the new one
    And "haven up -f" restarts even a matching stack
    And there is never a refusal

  @unit
  Scenario: Restarting one service bounces only that service
    Given the stack's launcher is running
    When the developer runs "haven restart nlp"
    Then only the nlp service's process group is terminated
    And the supervisor restarts it

  @unit
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

  # Tab one of the attached view (haven up and haven play alike) is a live
  # session dashboard, not a log stream: an ASCII harbour, the stack's status,
  # and per-service actions. The log groups follow it. Behaviour is in
  # app/session.go (the cheap live snapshot) and cmd/upviewer.go (the dashboard
  # tab), bound by app/session_test.go and cmd/upviewer_test.go.
  @unit
  Scenario: The session dashboard is the first thing haven up shows
    Given the attached view is open
    Then tab one is a status dashboard, ahead of the "all" and per-service log tabs
    And it shows the stack's liveness, RAM, and every service with an up/down dot
    And a log-only view (no wired actions) still opens straight on "all"

  @unit
  Scenario: The dashboard reports every service and shared server
    Then each routed service is listed in its CLI spelling, langy not langyagent
    And a service this worktree runs itself is marked restartable
    And a baseline fallback or shared database server is not
    And the proxy, the daemon, and the managed databases are reported as shared machinery

  @unit
  Scenario: Arrow keys move the cursor and open a service's logs
    Given the dashboard tab is showing
    When the developer moves the cursor with the arrow keys and presses enter on a service
    Then the view jumps to that service's own log tab
    And a service with no capture of its own opens the combined "all" stream instead

  @unit
  Scenario: Restarting a service from the dashboard bounces just that one
    Given the dashboard tab is showing with a restartable service under the cursor
    When the developer presses "r"
    Then only that service is bounced, without printing into the alt-screen
    And "a" bounces every service
    And a managed service refuses with a toast instead of a restart

  # The attached viewer takes the alt-screen, so it can only ever be for a human
  # terminal. Everything else streams plainly, and because that path never
  # backgrounds the launcher the stack is this process's own children.
  # Bound by cmd/uplifecycle_test.go.
  @unit
  Scenario: A piped up streams in the foreground
    When "haven up" runs with output piped (pnpm dev:haven | tee)
    Then it streams plainly in the foreground and Ctrl-C stops the stack
    And agent mode streams the same way even from a terminal

  # Attached and detached run the identical backgrounded child — the viewer is
  # only attached on top — so there is no second logging path to keep in step.
  # Bound by cmd/uplifecycle_test.go.
  @unit
  Scenario: A detached up logs the same as an attached one
    When the developer runs "haven up --detach"
    Then the stack starts in the background
    And "haven logs -t" follows it exactly as it would an attached stack
    And the detach flag itself is never passed to the backgrounded child
    And "haven down" stops it

  # Bound by app/switch_test.go.
  @unit
  Scenario: Switching to a worktree by name
    Given shell integration from "haven shell-init" is installed
    When the developer runs "haven switch" with a unique name prefix
    Then the shell changes directory to that worktree
    And a prefix matching several worktrees names them all rather than picking one
    And a name matching none lists what there is

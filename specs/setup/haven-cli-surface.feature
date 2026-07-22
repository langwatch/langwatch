Feature: haven CLI surface
  One name per command, one meaning per flag, one way to do each thing.
  The daily surface is six verbs (hub, up, down, restart, logs, status);
  destructive operations live under two nouns (db, clean). See ADR-064.

  Scenario: Every command has exactly one name
    When the developer runs "haven ps"
    Then it fails without doing anything
    And the error is one line pointing at "haven" (the hub)
    And the same holds for every removed alias: ls, active, rs, sw, ch, pg, obs, tc, oc, moron

  Scenario: A flag shorthand means one thing across the whole CLI
    Then "-f" is accepted only where it means "--follow"
    And no command accepts a "--force" flag
    And non-interactive confirmation of a destructive action is always "--yes"

  Scenario: Status is one word with one meaning
    When the developer runs "haven status"
    Then one report covers this worktree's selection and service health, the shared servers, and RAM footprints
    And "--json" emits the same report machine-readably
    And no other command or subcommand is named "status"

  Scenario: Bare haven opens the hub
    Given a terminal
    When the developer runs "haven"
    Then the interactive hub shows every stack with health, RAM, and actions
    And in agent mode or a pipe the same invocation prints the plain status report instead

  Scenario: An unknown command fails with a pointer, not a guess
    When the developer runs "haven upp"
    Then it fails listing the closest valid commands
    And nothing is started or changed

  Scenario: Down never touches data
    Given a running stack
    When the developer runs "haven down"
    Then the stack stops and its databases still exist
    And no flag on down can drop data

  Scenario: Down --all returns the machine
    Given stacks running in several worktrees
    When the developer runs "haven down --all"
    Then every stack, the shared servers, the observability stack, the daemon, and the proxy are stopped
    And no data is dropped

  Scenario: Fresh data is an explicit, confirmed noun
    When the developer runs "haven db reset"
    Then it states which databases will be dropped and recreated and asks for confirmation
    And "--yes" replaces the prompt for scripts and agents
    And "--demo" seeds the demo preset after the reset

  Scenario: Connection strings come from one place
    When the developer runs "haven db url postgres"
    Then this stack's Postgres connection string is printed
    And "clickhouse" and "redis" work the same way

  Scenario: Cleanup is one interactive command
    When the developer runs "haven clean"
    Then the interactive picker offers every worktree with its databases, disk size, and idle time
    And the safe categories — build artifacts and orphaned dev processes — are reclaimed in the same run
    And in agent mode it prints the report and deletes nothing
    And "haven clean --yes" applies only the safe categories, never worktree deletion

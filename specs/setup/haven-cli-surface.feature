@unit
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
    Then "-t" is accepted only where it means "--tail"
    And "-f" is accepted only where it means "--force" — forcing the lifecycle on up and down
    And non-interactive confirmation of a destructive DATA action is always "--yes", never "--force"

  @integration @unimplemented
  Scenario: Status is one word with one meaning
    When the developer runs "haven status"
    Then one report covers this worktree's selection and service health, the shared servers, and RAM footprints
    And "--json" emits the same report machine-readably
    And no other command or subcommand is named "status"

  @integration @unimplemented
  Scenario: Bare haven opens the hub
    Given a terminal
    When the developer runs "haven"
    Then the interactive hub shows every stack with health, RAM, and actions
    And in agent mode or a pipe the same invocation prints the plain status report instead

  Scenario: An unknown command fails with a pointer, not a guess
    When the developer runs "haven upp"
    Then it fails listing the closest valid commands
    And nothing is started or changed

  @integration @unimplemented
  Scenario: Down never touches data
    Given a running stack
    When the developer runs "haven down"
    Then the stack stops and its databases still exist
    And "haven down -f" kills hard instead of waiting on graceful shutdown
    And no flag on down can drop data

  @integration @unimplemented
  Scenario: Down --all returns the machine
    Given stacks running in several worktrees
    When the developer runs "haven down --all"
    Then every stack, the shared servers, the observability stack, the daemon, and the proxy are stopped
    And no data is dropped

  Scenario: Fresh data is an explicit, confirmed noun
    When the developer runs "haven db reset"
    Then it states which databases will be dropped and recreated and asks for confirmation
    And "--yes" replaces the prompt for scripts and agents
    And a preset name after "reset" seeds that preset, as in "haven db reset demo"

  # A registered stack's recorded database endpoints can be stale (a native
  # server since swapped for the container); the reset's children must not
  # follow them. Bound by tools/thuishaven app/db_test.go.
  Scenario: A reset migrates and seeds exactly the databases it dropped
    Given the worktree's stack is registered or not
    When the developer runs "haven db reset"
    Then the migrations and the seed run against the ClickHouse and Postgres databases it just dropped
    And they carry the same app origin "haven up" would give, so sign-in configuration loads

  # The shared database is what every worktree that never asked for its own
  # falls back to, so resetting it from the primary checkout takes data the
  # developer has no reason to think of as "this stack's". Bound by cmd/db_test.go.
  Scenario: Resetting the shared database asks for more than a keystroke
    Given the worktree's stack resolves to the shared main database
    When the developer runs "haven db reset"
    Then the prompt says the database is shared by every worktree without its own
    And only typing the database name continues — "y" does not
    And in agent mode it refuses, naming what the database is, until "--yes" is passed
    And "--yes" says which database it is about to drop before dropping it
    And a worktree's own database still takes a plain yes or no

  Scenario: Connection strings come from one place
    When the developer runs "haven db url postgres"
    Then this stack's Postgres connection string is printed
    And "clickhouse" and "redis" work the same way

  @integration @unimplemented
  Scenario: Cleanup is one interactive command
    When the developer runs "haven clean"
    Then the interactive picker offers every worktree with its databases, disk size, and idle time
    And the safe categories — build artifacts and orphaned dev processes — are reclaimed in the same run
    And in agent mode it prints the report and deletes nothing
    And "haven clean --yes" applies only the safe categories, never worktree deletion

  # An agent has one place to learn which simulators exist and how to drive
  # them; the verbs come from the command table, not a second list.
  # Bound by cmd/sims_test.go.
  Scenario: One command lists every simulator for an agent
    Given the worktree's stack runs mail but not llm
    When the agent runs "haven sims --json"
    Then there is one row per simulator: mail, idp, storage, llm, voice, analytics and telemetry
    And mail is running with its console URL
    And llm is not running and names "haven up +llm" to start it
    And every row lists the verbs its "haven <name>" command takes and its skill path

  # Bound by cmd/browser_record_test.go; the daemon half is browser-record.test.ts.
  Scenario: A browser lane's actions are recorded as a script and replayed
    Given a lane is recording with "haven browser record start --lane qa-1"
    When the lane fills a field, picks an option and clicks a button
    And "haven browser record stop --lane qa-1 --out flow.json" runs
    Then the script holds each action with a role, label or text locator, never a snapshot ref
    And each step holds the page path after it and the app queries it caused, without bodies
    And a password field's value is stored as "<redacted>"
    And "haven browser replay flow.json --lane qa-1" exits non-zero at the first step whose path or queries differ

  # Bound by cmd/browser_record_test.go.
  Scenario: A recorded script exports as a Playwright test in the repo's e2e style
    Given a recorded script
    When the agent runs "haven browser record export flow.json --playwright flow.spec.ts"
    Then the spec imports "expect" and "test" from "../test.ts" and asserts each step's path

Feature: Git inspection across worktrees via haven
  Working across several haven worktrees means constantly asking "what branch
  is that worktree on, what changed there, what's still uncommitted?" without
  wanting to cd around or check anything out. haven embeds the moron git TUI
  so one command answers those questions for any worktree, and agents get the
  same answers as plain text.

  # Behavior lives in tools/thuishaven: `cmd/git.go` (embeds the moron git
  # TUI via github.com/0xdeafcafe/moron/tui, so no separate install),
  # `app/git.go` (target resolution + the agent/plain overview),
  # `app/prune.go` (database reclaim during prune), and `domain/guard.go`
  # (local-dev + protected-database guards). Scenarios are bound by Go tests
  # (`go test ./...` in tools/thuishaven): `app/git_test.go`
  # (TestResolveGitTarget), `app/prune_test.go` (drop --all keeps lw_main),
  # `cmd/guard_test.go` + `domain/guard_test.go` (the local-dev refusal).
  # The parity checker (`platform/app/scripts/check-feature-parity.ts`) scans
  # tools/thuishaven's Go tests: @unit scenarios are bound by `// @scenario`
  # annotations above the Go test funcs; TUI-launch and end-to-end prune
  # flows remain `@unimplemented`.

  Background:
    Given a repository with several worktrees managed by haven

  @integration @unimplemented
  Scenario: Opening the git UI for the current worktree
    When I run "haven git" in a worktree
    Then the git TUI opens for that worktree
    And no separate tool has to be installed first

  @unit
  Scenario: Opening the git UI for another stack by slug
    Given a stack named "portless" is registered
    When I run "haven git portless"
    Then the git TUI opens for the "portless" stack's worktree
    And my current directory is unchanged

  @unit @unimplemented
  Scenario: Opening the git UI for a directory
    When I run "haven git ../worktrees/other"
    Then the git TUI opens for the repository containing that directory

  @unit
  Scenario: Unknown target is rejected with the available choices
    When I run "haven git nosuchslug"
    Then the command fails
    And the error lists the known stacks and worktrees I can pick from

  @integration @unimplemented
  Scenario: Agents get a plain git overview instead of a TUI
    When an agent runs "haven git"
    Then it prints one line per worktree with branch, dirty state, and whether the stack is up
    And no interactive UI is started

  @integration @unimplemented
  Scenario: Machine-readable git overview
    When I run "haven git --json"
    Then the same overview is printed as JSON

  @integration @unimplemented
  Scenario: Pruning a worktree also reclaims its databases
    Given a worktree haven has previously brought up, now neither up nor dirty
    When I run "haven prune --yes"
    Then the worktree's ClickHouse database is dropped
    And the worktree's Postgres database is dropped even if connections are still open
    And the shared database servers themselves keep running

  @integration @unimplemented
  Scenario: Prune dry-run announces database drops without acting
    Given a worktree haven has previously brought up, now neither up nor dirty
    When I run "haven prune"
    Then the databases that would be dropped are listed
    And nothing is dropped

  @unit
  Scenario: The standing main database survives bulk cleanup
    Given the shared "lw_main" database exists
    When I run "haven prune --yes" or "haven clickhouse drop --all" or "haven postgres drop --all"
    Then "lw_main" is kept
    And I am told it was kept because it is the standing main database

  @unit
  Scenario: Destructive commands refuse anything that is not local dev
    Given the worktree's effective DATABASE_URL points at a non-local host, a different database user, or a production-looking name
    When I run "haven seed"
    Then the command refuses before touching anything
    And the error says what looked wrong without echoing credentials

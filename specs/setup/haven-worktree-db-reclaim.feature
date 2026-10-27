Feature: Worktree database reclaim and destructive-command guards
  Deleting a worktree through haven reclaims the databases it made, never the
  standing main database, and no destructive command runs against anything that
  is not local dev. (haven git was dropped, ADR-064 amendment 2026-10-10; this
  feature kept the reclaim and guard scenarios it used to carry.)

  # Behavior lives in tools/thuishaven: `app/prune.go` (database reclaim, driven
  # by `haven machine clean`) and `domain/guard.go` (local-dev and
  # protected-database guards). Scenarios are bound by Go tests
  # (`go test ./...` in tools/thuishaven): `app/prune_test.go` (drop --all keeps
  # lw_main), `cmd/guard_test.go` + `domain/guard_test.go` (the local-dev refusal).

  Background:
    Given a repository with several worktrees managed by haven

  @integration @unimplemented
  Scenario: Deleting a worktree through haven machine clean reclaims its databases
    Given a worktree haven has previously brought up, now neither up nor dirty
    When I delete it through "haven machine clean"
    Then the worktree's ClickHouse database is dropped
    And the worktree's Postgres database is dropped even if connections are still open
    And the shared database servers themselves keep running

  @integration @unimplemented
  Scenario: haven machine clean previews the databases a worktree deletion would drop
    Given a worktree haven has previously brought up, now neither up nor dirty
    When I run "haven machine clean"
    Then the databases that would be dropped are listed before anything is deleted
    And nothing is dropped until I confirm

  @unit
  Scenario: The standing main database survives bulk cleanup
    Given the shared "lw_main" database exists
    When I run "haven machine clean --yes" or a worktree deletion drops its databases
    Then "lw_main" is kept
    And I am told it was kept because it is the standing main database

  @unit
  Scenario: Destructive commands refuse anything that is not local dev
    Given the worktree's effective DATABASE_URL points at a non-local host, a different database user, or a production-looking name
    When I run "haven db reset"
    Then the command refuses before touching anything
    And the error says what looked wrong without echoing credentials

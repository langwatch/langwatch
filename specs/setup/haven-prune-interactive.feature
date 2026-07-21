Feature: Interactive prune — pick which stale worktrees to delete
  A machine that juggles dozens of worktrees silts up: old feature branches
  keep their whole tree on disk (node_modules dominates) plus a ClickHouse and
  Postgres database each. `haven prune` used to only reclaim regenerable build
  artefacts. The interactive prune goes further: it scans every worktree at once,
  shows how big each is, which databases it owns, and how long it has sat idle,
  then lets me tick the ones to delete outright — pre-ticking everything that has
  been stale for five days or more so the common case is one keypress.

  # Behavior lives in tools/thuishaven:
  #   app/prune_scan.go  — PlanPrune (identity + guards), ScanWorktrees
  #     (concurrent size / database / staleness detection), DefaultSelected.
  #   adapters/prunetui/ — the loading-state picker (bubbletea), mirroring
  #     adapters/hubtui/. cmd/prune.go wires them; --artifacts keeps the old
  #     artefact-only reclaim (app/prune.go, unchanged).
  #   Deletion reuses app/hub.go DestroyWorktree, so the primary-checkout and
  #     running-from guards and the database-drop safety all apply unchanged.
  # Scenarios are bound by Go tests (`go test ./...` in tools/thuishaven):
  #   app/prune_scan_test.go (@unit: TestPlanPrune, TestScanWorktrees,
  #   TestScanWorktreesRunsConcurrently, TestDefaultSelected) and
  #   adapters/prunetui/prunetui_test.go (@unit: TestPruneModelPreselect,
  #   TestPruneModelManualToggleWins, TestPruneModelConfirmAndDelete,
  #   TestPruneSort, TestPruneViewportNeverOverflows). The live-terminal
  #   picker flows are @unimplemented.

  Background:
    Given several worktrees, some running a stack, some with uncommitted changes

  @unit
  Scenario: Every worktree is scanned concurrently for its footprint
    When I run "haven prune" in a terminal
    Then each worktree's disk size, databases, and idle time are detected in parallel
    And each row fills in its footprint as its scan lands, behind a loading state

  @unit
  Scenario: A worktree reports the resources deleting it would reclaim
    Given a worktree that ran a stack and left an lw_<slug> database behind
    When it is scanned
    Then its own disk size and ClickHouse and Postgres databases are reported as reclaimable
    And the shared ClickHouse, Postgres and Redis servers are shown as never removed

  @unit
  Scenario: Worktrees idle for five days or more are pre-selected
    Given a worktree whose last activity was more than five days ago
    And it is neither running nor holding uncommitted changes
    When the scan for it completes
    Then it is pre-selected for deletion by default

  @unit
  Scenario: A recently-touched worktree is left unselected
    Given a worktree whose last activity was yesterday
    When the scan for it completes
    Then it is not pre-selected

  @unit
  Scenario: A live or dirty worktree is never pre-selected
    Given a worktree that is running a stack, and another with uncommitted changes
    When their scans complete
    Then neither is pre-selected, though each can still be ticked by hand

  @unit
  Scenario: The primary checkout and the current worktree can never be deleted
    Given the primary checkout and the worktree I launched haven from
    When prune plans the worktrees
    Then both are marked protected and cannot be ticked for deletion

  @unit
  Scenario: A branch merged and deleted upstream is flagged
    Given a worktree whose branch tracks an upstream that no longer exists
    When it is scanned
    Then it is flagged "origin-gone" as a prime cleanup candidate

  @unit
  Scenario Outline: The list can be re-sorted
    Given a mix of worktrees differing in size, idle time, and origin state
    When I press "s" to cycle the sort to "<sort>"
    Then the "<winner>" worktree moves to the top, and protected worktrees stay last

    Examples:
      | sort        | winner              |
      | most idle   | the stalest         |
      | largest     | the biggest on disk |
      | origin-gone | the merged+deleted  |

  @unit
  Scenario: The list never overflows the terminal
    Given more worktrees than fit on screen
    When I scroll through them
    Then the header stays put, the list windows and scrolls, and no row wraps past the width

  @integration @unimplemented
  Scenario: Deleting the ticked worktrees
    Given I have ticked one or more worktrees in the picker
    When I confirm the deletion by typing "delete"
    Then each ticked worktree's stack is stopped, its databases dropped, and its directory removed
    And the total disk reclaimed is reported

  @integration @unimplemented
  Scenario: Agents get a read-only report instead of the picker
    When an agent runs "haven prune"
    Then the same concurrent scan runs and prints a plain table with a "*" on the stale-enough rows
    And nothing is deleted without a terminal

  @integration @unimplemented
  Scenario: The old artefact-only reclaim stays available
    When I run "haven prune --artifacts"
    Then only regenerable build artefacts are reclaimed and no worktree is deleted
    And "--yes" is still required to act rather than dry-run

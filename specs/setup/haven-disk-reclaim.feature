Feature: Reclaiming disk — temporary and merged worktrees, and agent job scratch
  A machine running several agents fills up in two places nobody looks at. Diff
  tools and agent lanes leave detached worktrees behind under .apidiff/,
  .claude/worktrees/ and worktrees/visual-*; branches get merged into main and
  their worktrees stay on disk for weeks. Meanwhile every agent job keeps a
  directory under ~/.claude/jobs holding its record and the scratch it produced
  getting there — a single finished run can hold thirteen gigabytes of tmp/.
  Both classes are regenerable, so haven reclaims them on its own cadence and
  offers them pre-ticked in "haven clean", instead of waiting for the disk to
  hit 100%.

  # Behavior lives in tools/thuishaven:
  #   domain/reclaim.go     — ClassifyWorktree: temporary / merged, and the
  #     guards (primary, current, dirty, live) that come before either.
  #   domain/jobscratch.go  — ClassifyJob: terminal state, the seven-day
  #     untouched rule, and the two record files a reclaim keeps.
  #   app/prune_reclaim.go  — PlanReclaimableWorktrees and the daemon's
  #     reapReclaimableWorktrees.
  #   app/jobs.go           — PlanJobs, ScanJobSizes, ReclaimJobs and the
  #     daemon's reapJobScratch.
  #   adapters/jobscratch/  — reads state.json, walks for the newest mtime and
  #     atime, sizes with du, and deletes everything but the record.
  #   cmd/clean.go          — the picker rows, the agent report's two new
  #     categories, and what "haven clean --yes" reclaims.
  # Scenarios are bound by Go tests (`go test ./...` in tools/thuishaven):
  #   app/prune_reclaim_test.go and app/jobs_test.go.

  Background:
    Given a machine with several worktrees and a directory of agent jobs

  @unit
  Scenario: A temporary worktree left by a diff tool is reclaimed after a day
    Given a detached worktree under the repository's .apidiff directory
    And it has no uncommitted changes and no stack running from it
    And nothing has touched it for more than a day
    When haven classifies the worktrees
    Then it is classified temporary and offered for reclaim with that reason

  @unit
  Scenario: A worktree on an agent-minted branch is reclaimed after a day
    Given a worktree whose branch name starts with "worktree-agent-"
    And nothing has touched it for more than a day
    When haven classifies the worktrees
    Then it is classified temporary

  @unit
  Scenario: A diff drive is judged by its directory, not by the ref it checked out
    Given a diff worktree created minutes ago at a year-old ref
    When haven classifies the worktrees
    Then it is not offered for reclaim, because nothing has been written in it since

  @unit
  Scenario: A temporary worktree touched this morning is left alone
    Given a detached worktree under .claude/worktrees touched an hour ago
    When haven classifies the worktrees
    Then it is not offered for reclaim

  @unit
  Scenario: A worktree whose branch is already on main is reclaimed
    Given a worktree whose branch is an ancestor of origin/main
    And it has no uncommitted changes and no stack running from it
    When haven classifies the worktrees
    Then it is classified merged and offered for reclaim with that reason

  @unit
  Scenario: A worktree with uncommitted changes is never reclaimed, whatever its age
    Given a temporary worktree untouched for a month that holds uncommitted changes
    When haven classifies the worktrees
    Then it is not offered for reclaim

  @unit
  Scenario: The primary checkout is never reclaimed automatically
    Given the repository's primary checkout, whose branch is on main
    When haven classifies the worktrees
    Then it is not offered for reclaim

  @unit
  Scenario: A worktree with a stack running from it is never reclaimed
    Given a merged worktree with a live registered stack
    When haven classifies the worktrees
    Then it is not offered for reclaim

  @unit
  Scenario: The daemon removes the classified worktrees and leaves their databases
    Given a temporary worktree and a merged worktree
    When the daemon runs its daily disk reclaim
    Then both directories are removed and the removal is recorded with its reason
    And neither worktree's ClickHouse or Postgres database is dropped

  @unit
  Scenario: A finished job's scratch is reclaimed and its record is kept
    Given a job directory whose state says the job is done
    And it holds a state file, a timeline, and a large tmp directory
    When haven reclaims the reclaimable jobs
    Then the tmp directory is gone and the state file and timeline remain

  @unit
  Scenario: A job untouched for a week is reclaimed whatever its state says
    Given a job directory neither modified nor read for more than seven days
    When haven classifies the jobs
    Then it is offered for reclaim as untouched

  @unit
  Scenario: A job a live process is working in is kept
    Given a job whose state says done but whose id appears in a live process
    When haven classifies the jobs
    Then it is kept, and reclaiming it by hand is refused

  @unit
  Scenario: The job haven was launched from is never reclaimed
    Given haven was launched from one of the job directories
    When haven classifies the jobs
    Then that job is kept even though its state says done

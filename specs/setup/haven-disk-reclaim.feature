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
  #   domain/reclaimkind.go — the nouns each kind is counted in, and the tally
  #     one cleanup ends with.
  #   cmd/clean.go          — the output mode, the two pickers, the picker rows,
  #     the agent report's two new categories, and what "haven clean --yes"
  #     reclaims.
  #   adapters/prunetui/    — the picker: newest-first order, the pre-ticks it is
  #     given, and the one-screen confirmation.
  # Scenarios are bound by Go tests (`go test ./...` in tools/thuishaven):
  #   app/prune_reclaim_test.go, app/jobs_test.go, cmd/clean_test.go,
  #   domain/reclaimkind_test.go and adapters/prunetui/prunetui_test.go.

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

  # A cleanup that reclaims two hundred things writes two hundred structured log
  # records. Sent to the same stream as the progress render they shred it, and
  # sent to the same stream as an agent's plain output they break the one line
  # per item it parses. Exactly one thing owns stdout per run.

  @unit
  Scenario: The structured log never shares a stream with the progress render
    Given a cleanup running in a terminal, where a full-screen picker draws the progress
    When haven decides who owns the output
    Then the picker owns the terminal and the structured log goes to haven's log file

  @unit
  Scenario: An agent's cleanup prints one line per item and no spinner
    Given a cleanup driven by an agent, or with its output piped elsewhere
    When haven decides who owns the output
    Then no picker is opened, each reclaimed item is one plain line, and the structured log still goes to the log file

  @unit
  Scenario: A finished cleanup counts and sizes each kind on its own
    Given a run that reclaimed both worktrees and agent job scratch
    When it reports what it freed
    Then each kind is named with its own count and its own total, never merged into one number

  # The reported defect: the progress line said "deleting 187 worktree(s)" while
  # it was emptying 187 agent job directories.

  @unit
  Scenario: Progress names the kind it is actually reclaiming
    Given a picker reclaiming agent job scratch
    When the reclaim is underway and when it finishes
    Then both lines count job scratch directories, and neither says worktree

  # Picker safety. The two kinds have different guards and different
  # consequences, so they are never one list, and the rows a mistake costs most
  # are the ones at the top of the screen.

  @unit
  Scenario: Worktrees and job scratch are two lists, never one
    Given a machine with worktrees to prune and agent jobs to reclaim
    When the cleanup builds its pickers
    Then it builds one list of worktrees and a separate list of job scratch, and neither holds a row of the other kind

  @unit
  Scenario: The newest work is at the top of the list, not buried below the old
    Given a mix of recently touched and long-idle items
    When the picker opens
    Then the newest is on top, where a mistaken tick is seen rather than scrolled past

  @unit
  Scenario: A job that finished this morning is not pre-ticked
    Given a job whose state says done and whose files were touched an hour ago
    When haven classifies the jobs
    Then it is not cold, so nothing pre-ticks it and no unattended pass reclaims it

  @unit
  Scenario: Reclaiming a job that finished within two days is refused unless asked for
    Given a job that finished an hour ago and a job that finished a week ago
    When a cleanup reclaims both without asking for the recent ones
    Then only the week-old job's scratch goes, and the recent one is refused with the flag that would reach it

  @unit
  Scenario: The confirmation shows the count, the size and the newest of what is ticked
    Given several ticked rows of one kind, of differing ages
    When the confirmation screen is shown
    Then it names the kind, the count, the total size and the newest ticked rows, and asks for the typed word

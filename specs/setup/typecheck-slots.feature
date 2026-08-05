Feature: Machine-wide slots for typecheck runs
  As a developer whose laptop runs several worktrees and agents at once
  I want `pnpm typecheck` to queue instead of piling up
  So that N parallel tsgo runs never take the machine down, and a slow run
  explains itself instead of looking hung

  # A tsgo run on this codebase peaks around 3 to 4 GiB and saturates every
  # core. One is fine. Three or four at once, which is the normal state of a
  # laptop driving several worktrees or agents, is what makes the machine
  # unusable. Nothing about `pnpm typecheck` knew that another one was already
  # running.
  #
  # `platform/app`'s typecheck scripts now run through
  # dev/scripts/typecheck-queue.mjs, a thin wrapper that takes a machine-wide
  # slot, runs the real command, and releases. The state is a directory of
  # per-run JSON entries (pid, arrival sequence, label, state) under the
  # system temp dir, so every worktree, terminal and agent on the machine
  # counts against the same total. Waiters are served in arrival order.
  #
  # The wrapper is deliberately boring on the happy path: with a free slot it
  # prints nothing at all and passes stdio, exit code and signals straight
  # through. It only speaks when a run has to wait, which is exactly when an
  # agent needs to know that the extra minutes were queueing rather than a
  # hung typechecker.
  #
  # Knobs, all optional:
  #   TYPECHECK_SLOTS=N            how many may run at once (0 disables the gate)
  #   TYPECHECK_QUEUE_DIR=<path>   where the shared state lives
  #   TYPECHECK_QUEUE_POLL_MS=N    how often a waiter re-checks
  #   TYPECHECK_QUEUE_HEARTBEAT_MS how often a waiting run repeats itself
  #   TYPECHECK_QUEUE_MAX_WAIT_MS  after this, run anyway rather than hang
  #
  # `haven typecheck` keeps its own RAM slot (ADR-064) and turns this gate off
  # for the run it spawns, so a run is never counted by both.

  # --- The happy path stays invisible ---

  @unit
  Scenario: A run that finds a free slot is silent
    Given no other typecheck run holds a slot
    When I run a typecheck through the queue
    Then the command runs immediately
    And the wrapper prints nothing of its own

  @unit
  Scenario: The wrapper is transparent to the command it runs
    Given a command that fails
    When I run it through the queue
    Then its exit code reaches the caller unchanged
    And its stdout and stderr are passed through untouched

  # --- Waiting, and saying so ---

  @unit
  Scenario: A run past the limit waits and names what it is waiting for
    Given the limit is 1 and a typecheck is already running
    When a second typecheck starts
    Then it does not run the command yet
    And it reports that 1 typecheck run is already active and that it is queued
    And the report names the limit and the environment variable that changes it

  @unit
  Scenario: A run that waited says how long it waited
    Given a run that spent time in the queue
    When its slot frees up
    Then it reports the time it spent queued before running the command

  @unit
  Scenario: A long wait repeats itself so it never looks hung
    Given a run has been queued for longer than the heartbeat interval
    When it re-checks
    Then it repeats its position and how long it has waited
    And it names the runs holding the slots and how long they have held them

  @unit
  Scenario: Waiters are served in arrival order
    Given the limit is 1, one run holding the slot and two queued behind it
    When the holder finishes
    Then the run that queued first is the one that starts

  # --- Nothing may hold a slot forever ---

  @unit
  Scenario: A slot held by a dead process is reclaimed
    Given a run holding the only slot is killed without releasing it
    When another run checks the queue
    Then the dead run's entry is dropped
    And the waiting run starts

  @unit
  Scenario: A run that waits too long runs anyway
    Given the maximum wait has elapsed and no slot has freed up
    When the waiting run re-checks
    Then it warns that it is starting without a slot
    And it runs the command rather than hanging

  # --- Choosing the limit ---

  @unit
  Scenario: The limit can be turned off
    Given TYPECHECK_SLOTS is 0
    When several typechecks run at once
    Then none of them queue

  @unit
  Scenario: An explicit limit is honored
    Given TYPECHECK_SLOTS is 1
    When three typechecks are started at once
    Then only one of them runs at a time

  @unit
  Scenario: The default limit is derived from the machine
    Given TYPECHECK_SLOTS is not set
    When the limit is resolved on a developer machine
    Then it is one slot per 6 GiB of RAM, capped at one per 4 CPUs, and never below 1

  @unit
  Scenario: CI does not queue by default
    Given CI is set and TYPECHECK_SLOTS is not
    When a typecheck runs
    Then the gate is off, because a CI runner runs one typecheck at a time anyway

  # --- Interaction with haven ---

  @unit
  Scenario: haven typecheck is not gated twice
    Given "haven typecheck" already holds one of its own RAM slots
    When it runs "pnpm typecheck"
    Then it passes TYPECHECK_SLOTS=0 to that run
    And the run is counted once, by haven's slot

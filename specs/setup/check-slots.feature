Feature: Machine-wide slots for whole-repo checks
  As a developer whose laptop runs several worktrees and agents at once
  I want `pnpm typecheck` and `pnpm lint` to queue instead of piling up
  So that N parallel checks never take the machine down, and a slow one
  explains itself instead of looking hung

  # Both checks saturate the machine on purpose. A tsgo run peaks around 3 to 4
  # GiB and uses every core; a biome run over 6,800 files spends 38 CPU-seconds
  # in 4 seconds of wall clock. That is the right trade for one run, and capping
  # either tool's threads only stretches the same CPU cost over 5x the wall
  # clock. Three or four at once, which is the normal state of a laptop driving
  # several worktrees or agents, is what makes the machine unusable, and neither
  # command knew another was already running.
  #
  # `platform/app`'s typecheck, lint and format scripts now run through
  # dev/scripts/check-queue.mjs, a thin wrapper that takes a machine-wide
  # slot, runs the real command, and releases. ONE counter covers all of them,
  # because they compete for the same cores. The state is a directory of
  # per-run JSON entries (pid, arrival sequence, label, state) under the
  # system temp dir, so every worktree, terminal and agent on the machine
  # counts against the same total. Waiters are served in arrival order.
  #
  # The wrapper is deliberately boring on the happy path: with a free slot it
  # prints nothing at all and passes stdio, exit code and signals straight
  # through. It only speaks when a run has to wait, which is exactly when an
  # agent needs to know that the extra minutes were queueing rather than a
  # hung tool.
  #
  # Knobs, all optional:
  #   CHECK_SLOTS=N            how many may run at once (0 disables the gate)
  #   CHECK_QUEUE_DIR=<path>   where the shared state lives
  #   CHECK_QUEUE_POLL_MS=N    how often a waiter re-checks
  #   CHECK_QUEUE_HEARTBEAT_MS how often a waiting run repeats itself
  #   CHECK_QUEUE_MAX_WAIT_MS  after this, run anyway rather than hang
  #
  # `haven typecheck` keeps its own RAM slot (ADR-064) and turns this gate off
  # for the run it spawns, so a run is never counted by both.

  # --- The happy path stays invisible ---

  @unit
  Scenario: A run that finds a free slot is silent
    Given no other check holds a slot
    When I run a check through the queue
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
    Given the limit is 1 and a check is already running
    When a second check starts
    Then it does not run the command yet
    And it reports that 1 check is already active and that it is queued
    And the report names the limit and the environment variable that changes it

  @unit
  Scenario: Lint and typecheck queue against the same counter
    Given the limit is 1 and a typecheck is already running
    When a lint starts
    Then the lint waits for the typecheck to finish
    And the two never run at the same time, because they compete for the same cores

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
  Scenario: A malformed entry from another branch cannot crash the queue
    Given the shared directory holds an entry written in a shape this branch does not understand
    When a check reads the queue
    Then the entry is dropped rather than reaching code that assumes its fields
    And the check runs

  @unit
  Scenario: A queue that cannot be created degrades to an unqueued run
    Given the shared directory cannot be created or written
    When a check starts
    Then it warns that the queue is unavailable
    And it runs the command without a slot, because the queue is a courtesy and never a gate

  @unit
  Scenario: A run that waits too long runs anyway
    Given the maximum wait has elapsed and no slot has freed up
    When the waiting run re-checks
    Then it warns that it is starting without a slot
    And it runs the command rather than hanging

  # --- Choosing the limit ---

  @unit
  Scenario: The limit can be turned off
    Given CHECK_SLOTS is 0
    When several checks run at once
    Then none of them queue

  @unit
  Scenario: An explicit limit is honored
    Given CHECK_SLOTS is 1
    When three checks are started at once
    Then only one of them runs at a time

  @unit
  Scenario: The default limit is derived from the machine
    Given CHECK_SLOTS is not set
    When the limit is resolved on a developer machine
    Then it is one slot per 6 GiB of RAM, capped at one per 4 CPUs, and never below 1

  @unit
  Scenario: CI does not queue by default
    Given CI is set and CHECK_SLOTS is not
    When a check runs
    Then the gate is off, because a CI runner runs one check at a time anyway

  # --- Interaction with haven ---

  @unit
  Scenario: haven typecheck is not gated twice
    Given "haven typecheck" already holds one of its own RAM slots
    When it runs "pnpm typecheck"
    Then it passes CHECK_SLOTS=0 to that run
    And the run is counted once, by haven's slot

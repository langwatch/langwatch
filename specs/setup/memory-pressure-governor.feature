Feature: The daemon watches the machine, slows what it can, and reports what it cannot
  As a developer whose laptop is shared by several worktrees, ten agents and a container VM
  I want the daemon to notice real memory pressure and respond proportionally
  So that the worktree I am looking at stays responsive, and nothing loses work to
  a governor's opinion about which process mattered

  # Behaviour lives in tools/thuishaven: the daemon's monitorLoop (app/daemon.go)
  # already ticks every 10s and already reads per-stack GroupRSS and machine
  # TotalMemory (adapters/system/system.go); none of it is currently interpreted.
  # See ADR-087.
  #
  # SUMMED RSS IS NOT THE SIGNAL. It double-counts shared pages and overstates
  # by several GB. The honest signals on macOS are the compressor's OCCUPIED
  # pages (vm_stat) and swap usage (sysctl vm.swapusage). Note the page size is
  # 16384 on Apple silicon, not 4096 — multiplying by the wrong constant
  # understates the compressor by 4x and the governor would never fire.
  #
  # MACOS HAS NO CGROUPS, so there is no way to give a stack a hard memory
  # bound. What it does have is `taskpolicy -b`, which moves a running process
  # into the throttled background band for CPU and IO, and which children
  # inherit. So the response to pressure is to slow the stacks the developer is
  # not looking at, not to bound or kill them.
  #
  # The daemon publishes its reading to a file that check-queue.mjs and
  # `haven run` read (specs/setup/heavy-run-admission.feature). It does not
  # reach into those processes.

  # --- Reading the machine ---

  @unit @unimplemented
  Scenario: Pressure is classified from the compressor and swap, not from summed RSS
    When the daemon samples the machine
    Then the reading comes from compressor occupancy and swap usage
    And summed process RSS is not what decides the level

  @unit @unimplemented
  Scenario: An undetectable machine reads as unloaded
    Given the machine's memory cannot be read
    When pressure is classified
    Then the level is green
    Because a governor must never throttle on a guess

  @unit @unimplemented
  Scenario: The level has three steps with distinct responses
    When pressure is classified
    Then green spends freely, amber stops admitting new heavy work, and red demotes and reports
    And each step's response is proportional to what the machine is actually doing

  @integration @unimplemented
  Scenario: The reading is published for other processes to read
    When the daemon completes a tick
    Then the current level is written to its state directory
    And a stale or missing file is read by others as green

  # --- Slowing rather than killing ---

  @integration @unimplemented
  Scenario: Under pressure the unfocused stacks are demoted
    Given several stacks are running and one worktree is focused
    When pressure reaches amber
    Then every stack except the focused one is moved into the background scheduling band
    And no process is stopped, because demotion is reversible and losing work is not

  @integration @unimplemented
  Scenario: At critical pressure the daemon names the worst offender but does not act on it
    Given pressure is red
    When the daemon completes a tick
    Then it names the largest stack and the command that would stop it
    But it does not stop it, because it did not start that work

  @integration @unimplemented
  Scenario: Demotion is lifted when pressure clears
    Given stacks were demoted under pressure
    When pressure returns to green
    Then they are restored to the normal scheduling band

  # --- Reclaiming what is unambiguously garbage ---

  # An interrupted vitest run orphans its workers to ppid 1, which CLAUDE.md
  # currently documents as a manual pkill chore. A worker whose parent is init
  # is owned by nobody. That is the whole rule — anything needing a judgement
  # about whether a process is still wanted stays manual.
  @integration @unimplemented
  Scenario: Orphaned test workers are swept
    Given a vitest worker process whose parent is init
    When the daemon completes a tick
    Then that worker is reclaimed
    And a worker with a live parent is left alone

  # --- Reporting what the daemon cannot fix ---

  # Runtime.Ensure applies colima limits only when haven creates the profile,
  # deliberately, so it never resizes a VM someone else sized on purpose. The
  # consequence is that an oversized VM is invisible to haven forever unless
  # someone is told.
  @integration @unimplemented
  Scenario: A container VM sized outside haven's budget is reported, not resized
    Given the colima profile is larger than the budget haven is configured with
    When I run the doctor
    Then it reports the drift and prints the exact commands to reconcile it
    But it does not resize the profile

  @integration @unimplemented
  Scenario: The doctor shows what admission control actually did
    When I run the doctor
    Then it reports the current pressure level
    And how many heavy runs were gated, narrowed, denied and parked
    And how many parks crossed the prompt-cache floor, which should always be zero

  # That last count is the one number that says whether this whole mechanism is
  # a net win. A non-zero value means the wait ceiling is wrong and the governor
  # is costing more than it saves, so it is reported rather than inferred.

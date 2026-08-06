Feature: The daemon watches the machine, slows what it can, and reports what it cannot
  As a developer whose laptop is shared by several worktrees, ten agents and a container VM
  I want the daemon to notice real memory pressure and respond proportionally
  So that the worktree I am looking at stays responsive, and nothing loses work to
  a governor's opinion about which process mattered

  # Behaviour lives in tools/thuishaven. The daemon's monitorLoop (app/daemon.go)
  # already ticks every 10s, reaping dead and stale stacks and pruning idle
  # databases; it does not sample memory at all. The primitives exist elsewhere
  # and are already used: GroupRSS is read by app/report.go for the doctor's
  # footprint lines, and TotalMemory by app/typecheck.go to size slots. What is
  # new here is a pressure reading on the tick, and publishing it. See ADR-087.
  #
  # SUMMED RSS IS NOT THE SIGNAL. GroupRSS sums `ps` output, which double-counts
  # shared pages and overstates by several GB. The honest signals on macOS are
  # the compressor's OCCUPIED pages (vm_stat) and swap usage (sysctl
  # vm.swapusage). In the measurement that motivated this, occupied was about
  # 128k pages — roughly 2 GiB — while pages STORED in the compressor was 679k;
  # quoting stored would overstate the same machine by five times. Note the page
  # size is 16384 on Apple silicon, not 4096: multiplying by the wrong constant
  # understates the compressor 4x and the governor never fires.
  #
  # DEMOTION, NOT A MEMORY BOUND — but not because a bound is impossible.
  # `taskpolicy -m <MiB>` sets a jetsam memory limit and `-j` a jetsam
  # priority, both at spawn. That is rejected on its merits rather than on
  # impossibility: jetsam KILLS the process that breaches its limit, which is
  # the lost-work outcome this whole design is arranged to avoid, and
  # RunOnceBounded already covers the runaway case.
  #
  # What is used instead is `taskpolicy -b`, which moves a process into the
  # throttled background band for CPU and IO, with `-B` to move it back out.
  # `-p` applies both to an already-running process. But the inheritance
  # guarantee covers children of a program LAUNCHED under the policy, not a
  # tree that is already running — and a live stack is precisely a tree of
  # already-running children (vite, node, workers under the launcher). So
  # demotion walks the process group; signalling the launcher alone would
  # demote the launcher alone.

  # --- Reading the machine ---

  @unit @unimplemented
  Scenario: Pressure is classified from the compressor and swap, not from summed RSS
    When the daemon samples the machine
    Then the reading comes from compressor occupancy and swap usage
    And summed process RSS is not an input to the level

  @unit @unimplemented
  Scenario: Compressor occupancy is read in bytes, not pages
    When compressor occupancy is computed
    Then the page count is multiplied by the machine's own page size
    And the occupied count is used rather than the stored count

  @unit @unimplemented
  Scenario: Either signal alone can raise the level
    Given a machine with swap disabled, so its swap term is permanently zero
    When compressor occupancy alone crosses the threshold
    Then the level rises
    Because a machine with no swap file still thrashes its compressor

  @unit @unimplemented
  Scenario: An undetectable machine reads as unloaded
    Given the machine's memory cannot be read
    When pressure is classified
    Then the level is green
    Because a governor must never throttle on a guess

  @unit @unimplemented
  Scenario: The three levels have distinct, named responses
    When pressure is classified
    Then green admits heavy runs at full width and demotes nothing
    And amber demotes the unfocused stacks and stops admitting at full width
    And red additionally refuses a heavy run that finds no free slot
    # These are rows of the precedence table in ADR-087. Amber does not refuse
    # work; it stops work being admitted at full width.

  # --- Publishing ---

  @integration @unimplemented
  Scenario: The reading is published for other processes to read
    When the daemon completes a tick
    Then the current level is written to its state directory with a version and a timestamp

  @unit @unimplemented
  Scenario: A reading that cannot be trusted reads as green
    Given a pressure file that is absent, unparseable, or older than the staleness threshold
    When a reader consults it
    Then it reads green
    And it does not fail, because a reader that dies on a bad file is worse than one that ignores it

  # --- Slowing rather than killing ---

  @integration @unimplemented
  Scenario: Under pressure the unfocused stacks are demoted
    Given several stacks are running and one worktree is focused
    When pressure reaches amber
    Then every stack except the focused one is moved into the background scheduling band
    And no process is stopped, because demotion is reversible and losing work is not

  @integration @unimplemented
  Scenario: Demotion covers the children that are already running
    Given a stack whose launcher has already spawned its children
    When that stack is demoted
    Then every process in its group is demoted, not just the launcher
    Because the policy is inherited by processes forked afterwards, not applied retroactively

  @integration @unimplemented
  Scenario: Focus that cannot be determined demotes nothing
    Given the focused worktree cannot be identified
    When pressure reaches amber
    Then no stack is demoted
    Because demoting all of them includes the one being worked in

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
    And a child spawned while its stack was demoted is restored with it

  # --- Reclaiming what is unambiguously garbage ---

  # haven already sweeps orphans: procsupervisor.reapOrphans reclaims
  # dev-runtime processes whose parent is PID 1 in known directories, at every
  # `haven up`. This extends that same rule to test workers and runs it on the
  # daemon's tick. On macOS PID 1 is launchd.
  @integration @unimplemented
  Scenario: Orphaned test workers are swept
    Given a vitest worker process whose parent is PID 1
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
    And how many heavy runs were gated, narrowed, queued and refused

  @integration @unimplemented
  Scenario: The doctor reports both ways a run can lose its cache
    When I run the doctor
    Then it reports sub-agent parks whose wait crossed their five-minute floor
    And narrowed runs whose actual duration crossed it
    And main-session and interactive waits are counted in neither
    # Sub-agents are the population that expires: measured across 40
    # transcripts, they write the five-minute cache 100% of the time while main
    # sessions write the one-hour cache 100% of the time. Counting a main
    # session's wait here would drown the signal, since it has an hour of
    # headroom and the failsafe stops well inside it.
    #
    # Both counters should sit near zero. A non-zero first means the ceiling is
    # wrong; a non-zero second means narrowing bought nothing and burned the
    # cache anyway, which the park counter alone would report as success.

  # Those two counters are the ones that say whether this mechanism is a net
  # win, and there have to be two. A park past the floor means the wait ceiling
  # is wrong. A narrowed run past the floor means narrowing bought nothing and
  # burned the cache anyway — which the park counter alone would report as zero.
  # Interactive waits are excluded because a human's twelve-minute wait is not
  # an idle API session, and counting it would make both numbers meaningless.

  @integration @unimplemented
  Scenario: The counters survive the process that produced them
    Given the queue wrapper is a short-lived process whose entries are deleted on release
    When it narrows, queues or refuses a run
    Then it records that where the daemon can read it
    # Named explicitly because every other state flow in this design is daemon
    # to reader; this one is the reverse and is easy to discover only during
    # implementation.

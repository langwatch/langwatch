Feature: Heavy runs are admitted, queued, or refused
  As a developer whose laptop runs several worktrees and around ten agents at once
  I want a heavy run to wait its turn rather than land on top of the others
  So that N parallel vitest runs never take the machine down, and the rare session
  whose prompt cache expires quickly is not parked past it

  # Extends specs/setup/check-slots.feature, which put `typecheck`, `lint` and
  # `format` behind one machine-wide counter in dev/scripts/check-queue.mjs.
  # This feature adds the runs that counter never covered. See ADR-090 for the
  # precedence table these scenarios are rows of.
  #
  # 1. TESTS WERE NOT ON THE COUNTER, and they are the larger problem. Measured
  # mid-session on an 11-core / 18 GiB machine: 17 node processes, 550-712 MB
  # each, PIDs inside a 250-PID range — one simultaneous burst of about 10.5 GB,
  # alongside an 8 GB colima VM. Those are vitest workers under `pool:
  # "vmForks"`, which platform/app/vitest.config.ts picks deliberately and
  # measures at 573 MB per fork — which is what the observed range is.
  # `maxWorkers: "50%"` is 5 workers PER RUN on 11 cores, so three or four
  # agents testing at once is 15-20 workers.
  #
  # 2. THE LIMIT WAS DERIVED FROM TOTAL RAM, which the process does not have.
  # One slot per 6 GiB of os.totalmem() counts the 8 GiB inside the colima VM.
  #
  # WHICH CACHE FLOOR APPLIES DEPENDS ON WHO IS ASKING, and that was measured
  # rather than assumed. A scan of 40 real transcripts — 14,121 cache-writing
  # requests, about 53M cache-write tokens — comes back perfectly bimodal:
  #
  #   sub-agent transcripts    100% ephemeral_5m   (5,960 requests, 28.3M tokens)
  #   main-session transcripts 100% ephemeral_1h   (8,161 requests, 25.4M tokens)
  #
  # Not one request wrote both, so this is not a breakpoint split. Claude Code
  # gives a main session the one-hour cache and a sub-agent the five-minute one.
  #
  # THAT MATTERS BECAUSE THE POPULATION THIS FEATURE GOVERNS IS THE SUB-AGENTS.
  # Ten parallel agents on a worktree are ten five-minute caches, so a queue
  # deep enough to hold one past five minutes really does cost a cold re-read.
  # The one-hour floor belongs to the single main session per worktree, where
  # #6598's existing 30-minute failsafe already sits comfortably inside it.
  #
  # So: queueing is the default and the only lever for a main session, and
  # narrowing exists for sub-agent runs that fit inside five minutes. A
  # sub-agent run too long to fit is queued anyway, because its cache is lost
  # by running and narrowing would buy nothing.
  #
  # The bust differs by population too, in the opposite direction to the floor.
  # A five-minute write costs 1.25x base input against a read's 0.1x — a 1.15x
  # premium, about $1.73 on a 300k-token prefix at Opus 5's input rate. A
  # one-hour write costs 2x, a 1.9x premium, about $2.85. Sub-agents park
  # cheaply per token but expire fast; main sessions park expensively but
  # almost never expire.
  #
  # No inference is needed to tell them apart: the hook payload carries
  # agent_id inside a sub-agent and omits it in a main session.
  #
  # NEIGHBOURS, so this file's boundary is explicit rather than discovered
  # later. specs/setup/memory-footprint.feature is about what a single process
  # LOADS; specs/setup/in-process-workers-dev.feature is about HOW MANY
  # processes a stack runs; specs/setup/haven-resource-caps.feature caps the
  # shared services. This file is about how many heavy runs may start at once,
  # and touches none of those levers.
  #
  # specs/setup/integration-file-serialism.feature owns the integration suite's
  # own concurrency, and this file must not reach into it — see the
  # never-narrowed scenario below.

  # --- Tests join the existing counter ---

  @unit @unimplemented
  Scenario: A test run counts against the same slots as a typecheck
    Given pressure is green and the limit is 1
    And a typecheck is already running
    When a unit test run starts
    Then it does not run its command yet
    And the two never run at the same time, because they compete for the same cores and RAM

  @unit @unimplemented
  Scenario: A test run started through its package script is counted
    Given pressure is green and the limit is 1
    And a unit test run is already holding the slot
    When a second unit test run is started the way a developer starts one
    Then the two never overlap

  # --- Admitted exactly once ---

  # ADR-091's gate rewraps an agent's command under `haven run --class heavy`,
  # which holds a slot of its own. The wrapped command is still a package script
  # that routes through this counter, so without a handoff the outer run waits
  # for the inner one and at a limit of 1 it waits for itself. #6598 already
  # established the rule for `haven typecheck`, which passes CHECK_SLOTS=0.
  @unit @unimplemented
  Scenario: A run already admitted by haven is not admitted a second time
    Given a run that haven has already taken a slot for
    When its inner package script reaches the counter
    Then the counter stands down for that run
    And the run holds exactly one slot, not two

  @unit @unimplemented
  Scenario: A run not admitted by haven is counted normally
    Given a run started directly, with no outer holder
    When it reaches the counter
    Then it takes a slot of its own

  # --- Queueing is the default answer ---

  @unit
  Scenario: A main-session run with no slot free waits
    Given pressure is green and no slot is free
    And the run was started by a main session rather than a sub-agent
    When a heavy run starts
    Then it waits for a slot rather than being narrowed
    Because a main session holds the one-hour cache, so the wait costs nothing

  @unit
  Scenario: A main session keeps the long failsafe
    Given a heavy run started by a main session
    When it waits for a slot
    Then the existing thirty-minute failsafe applies
    And no shorter ceiling is imposed, because thirty minutes sits inside an hour

  # --- Narrowing, for the population that actually expires ---

  @unit
  Scenario: A short sub-agent run is narrowed instead of queued
    Given no slot is free
    And the run was started by a sub-agent, which holds the five-minute cache
    And this command has been observed to finish inside five minutes when narrowed
    When a unit test run starts
    Then it is given a smaller worker count and starts immediately

  # specs/setup/integration-file-serialism.feature owns the integration suite's
  # concurrency and treats a worker count arriving from the environment as
  # something to withdraw — and, if a second worker appears anyway, as a reason
  # to fail the run naming the count that re-enabled concurrency. The
  # integration config already clamps to one worker locally, so there is
  # nothing to narrow and any attempt to narrow it is at best inert and at
  # worst trips that guard. Narrowing is therefore a unit-test lever only.
  @unit
  Scenario: An integration run is never narrowed
    Given no slot is free
    And the run is an integration suite
    When it is admitted
    Then its worker count is left entirely alone
    And it queues instead, because its files are serial by construction

  @unit
  Scenario: A long sub-agent run is queued anyway
    Given no slot is free
    And the run was started by a sub-agent
    And this command has been observed to take longer than five minutes
    When a unit test run starts
    Then it waits for a slot
    Because its cache is lost by running, so narrowing buys nothing

  @unit
  Scenario: A command haven has never seen is queued
    Given a command with no recorded duration
    When it finds no free slot
    Then it queues rather than narrowing

  @unit
  Scenario: A caller that cannot be identified keeps the main-session ceiling
    Given a heavy run whose caller cannot be identified
    When it finds no free slot
    Then the thirty-minute failsafe applies to it
    Because an absent agent id is how a main session arrives, not a third state
    And defaulting the other way would narrow and background every main-session run

  @unit
  Scenario: A narrowed run still takes a slot
    Given a run that is narrowed rather than queued
    When it starts
    Then it consumes admission like any other run
    And its worker count divides by the runs actually in flight, not by the configured limit
    So ten narrowed runs cannot reproduce the burst this feature exists to prevent

  @unit
  Scenario: A run that cannot be narrowed always queues
    Given a typecheck, which is a single process with nothing to divide
    When it finds no free slot
    Then it queues

  @unit
  Scenario: A caller's own worker count is respected but still admitted
    Given a test command that already specifies its worker count
    When it goes through the counter
    Then the count it asked for is not overridden
    But it is admitted, queued or refused by the same rules as any other run

  # --- Narrowing under pressure, which is a different argument ---
  #
  # The narrowing above is about a sub-agent's cache expiring in a queue. This
  # one is about the machine: a loaded machine has to stop handing out full
  # width even when it still has a slot, or the middle pressure level changes
  # nothing anybody can observe.

  @unit
  Scenario: A loaded machine stops admitting at full width
    Given the machine is under memory pressure
    And a slot is still free
    When a unit test run starts
    Then it starts immediately, but not at full width
    And the same applies to a main session, because this is about the machine
    But a run started from a terminal is left entirely alone
    Because a human is waiting on the result rather than holding a cache

  @unit
  Scenario: A run narrowed by pressure gives up half its width
    Given a run narrowed because the machine is loaded rather than because it queued
    Then it gives up half its width
    And never falls below one worker
    Because the memory pressure is held by whatever else is on the machine,
    So dividing by an idle heavy pool would hand back full width and mean nothing

  @unit
  Scenario: A narrowed run is actually run at the narrower width
    Given a run the gate admitted at a reduced worker count
    When it runs
    Then that count is applied to the run
    And the caller's command line is left exactly as it was written
    Because a narrowing nobody applies is a decision the machine never sees

  # --- What haven learns from a run ---

  @unit
  Scenario: Timings are filed under what the command actually is
    Given an integration suite invoked directly through vitest rather than its package script
    When its duration is recorded
    Then it is filed as an integration run
    And a unit run cannot inherit that timing
    Because a ten-minute suite in the unit bucket narrows a run that should have queued

  @unit
  Scenario: A run that failed is not evidence of how long it takes
    Given a heavy run that fails part-way through
    When it finishes
    Then nothing is recorded against that command's duration
    Because a suite that died after two seconds is not a two-second suite,
    And the next caller would be narrowed on the strength of a crash

  @unit
  Scenario: Timings survive several runs finishing at once
    Given several heavy runs recording different commands at the same moment
    When each folds its own timing into the estimate
    Then every command's timing is still there afterwards
    Because one file holds all of them and each writer publishes the whole of it,
    And a timing dropped that way reads as a command nobody has ever timed

  # --- Refusal ---

  @unit
  Scenario: At critical pressure a run with no slot is refused
    Given pressure is red and no slot is free
    When a heavy run starts
    Then it does not run and does not queue
    And it exits with a distinct status and a reason naming the pressure and the queue depth

  @unit
  Scenario: At critical pressure a run with a slot free still proceeds
    Given pressure is red and a slot is free
    When a heavy run starts
    Then it runs
    Because red throttles admission, it does not stop the machine working

  # --- A tightened ceiling, only where it is earned ---

  @unit
  Scenario: A sub-agent is not held past its five-minute floor
    Given a heavy run started by a sub-agent
    When it waits for a slot
    Then the wait is capped below five minutes
    And when the cap is reached it proceeds rather than waiting longer

  @unit
  Scenario: An interactive run keeps the long failsafe
    Given a run started from a terminal
    When it waits for a slot
    Then the thirty-minute failsafe applies
    Because a human waiting is not an idle API session

  @unit @unimplemented
  Scenario: A run that reached its wait cap says what happened
    Given a sub-agent run that waited up to its cap
    When it proceeds
    Then it reports how long it waited and that the cap was reached
    So a slow run is never mistaken for a hung one

  # --- Fail open, but only the part that should ---

  # The pressure file exists only while the haven daemon runs. #6598's queueing
  # never depended on it — occupancy comes from the queue directory. So a
  # developer running plain pnpm with no daemon must keep exactly the protection
  # they have today.
  @unit @unimplemented
  Scenario: An unreadable pressure signal disables narrowing, not counting
    Given the pressure signal is missing, stale or unparseable
    When a heavy run is admitted
    Then the machine is read as unloaded, so nothing is narrowed and nothing is refused
    But slot counting behaves exactly as it does without a governor at all

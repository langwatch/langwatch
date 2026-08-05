Feature: Heavy runs are admitted, queued, or refused
  As a developer whose laptop runs several worktrees and around ten agents at once
  I want a heavy run to wait its turn rather than land on top of the others
  So that N parallel vitest runs never take the machine down, and the rare session
  whose prompt cache expires quickly is not parked past it

  # Extends specs/setup/check-slots.feature, which put `typecheck`, `lint` and
  # `format` behind one machine-wide counter in dev/scripts/check-queue.mjs.
  # That spec and that script arrive with PR #6598, which is OPEN AND UNMERGED
  # at the time of writing — this feature is stacked on it and neither the file
  # reference above nor the scenarios below resolve until it lands. See ADR-087
  # for the precedence table these scenarios are rows of.
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
  # WHY QUEUEING AND NOT NARROWING. Earlier drafts made narrowing the primary
  # lever, on the premise that a queued run parks an agent past its prompt
  # cache's idle expiry. A probe settled it: Claude Code writes ephemeral_1h
  # cache entries, with ephemeral_5m at zero. The idle floor is about an hour,
  # so #6598's existing 30-minute failsafe already sits inside it and a wait
  # costs nothing in tokens. Queueing also dominates narrowing for the machine
  # — a queued run holds no RAM, a narrowed one holds some.
  #
  # The five-minute floor is still real, just not the default: a session in
  # usage overage falls back to it. So narrowing survives as a fallback for
  # exactly that regime, which is DETECTED rather than assumed — a session's
  # transcript reports which of the two lifetimes its cache writes went to.
  #
  # The bust is worse than earlier drafts said, though. On the one-hour TTL a
  # cache write costs 2x base input against a read's 0.1x, so re-caching a
  # prefix costs a 1.9x premium — about $2.85 on a 300k-token prefix at Opus
  # 5's input rate, not the $1.73 the five-minute figure gave.

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

  # ADR-088's gate rewraps an agent's command under `haven run --class heavy`,
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

  @unit @unimplemented
  Scenario: A run with no slot free waits
    Given pressure is green and no slot is free
    And the session's recent cache writes went to the long-lived cache
    When a heavy run starts
    Then it waits for a slot rather than being narrowed
    Because the wait costs nothing while the cache outlives it

  @unit @unimplemented
  Scenario: The long failsafe stands unchanged on the long-lived cache
    Given a session whose cache writes went to the long-lived cache
    When a run waits for a slot
    Then the existing thirty-minute failsafe applies
    And no shorter ceiling is imposed, for an agent or for a person

  # --- Narrowing, only where the short-lived cache makes waiting cost something ---

  @unit @unimplemented
  Scenario: A short run on the short-lived cache is narrowed instead of queued
    Given no slot is free
    And the session's recent cache writes went to the short-lived cache
    And this command has been observed to finish inside that shorter floor when narrowed
    When a unit test run starts
    Then it is given a smaller worker count and starts immediately

  @unit @unimplemented
  Scenario: A long run is queued even on the short-lived cache
    Given no slot is free
    And the session's recent cache writes went to the short-lived cache
    And this command has been observed to take longer than that floor
    When a unit test run starts
    Then it waits for a slot
    Because its cache is lost by running, so narrowing buys nothing

  @unit @unimplemented
  Scenario: A command haven has never seen is queued
    Given a command with no recorded duration
    When it finds no free slot
    Then it queues rather than narrowing

  @unit @unimplemented
  Scenario: A session whose cache lifetime cannot be determined is treated as long-lived
    Given a session whose recent cache writes cannot be read
    When a heavy run finds no free slot
    Then it queues on the ordinary failsafe
    Because assuming the short-lived cache would narrow every run on a false alarm

  @unit @unimplemented
  Scenario: A narrowed run still takes a slot
    Given a run that is narrowed rather than queued
    When it starts
    Then it consumes admission like any other run
    And its worker count divides by the runs actually in flight, not by the configured limit
    So ten narrowed runs cannot reproduce the burst this feature exists to prevent

  @unit @unimplemented
  Scenario: A run that cannot be narrowed always queues
    Given a typecheck, which is a single process with nothing to divide
    When it finds no free slot
    Then it queues

  @unit @unimplemented
  Scenario: A caller's own worker count is respected but still admitted
    Given a test command that already specifies its worker count
    When it goes through the counter
    Then the count it asked for is not overridden
    But it is admitted, queued or refused by the same rules as any other run

  # --- Refusal ---

  @unit @unimplemented
  Scenario: At critical pressure a run with no slot is refused
    Given pressure is red and no slot is free
    When a heavy run starts
    Then it does not run and does not queue
    And it exits with a distinct status and a reason naming the pressure and the queue depth

  @unit @unimplemented
  Scenario: At critical pressure a run with a slot free still proceeds
    Given pressure is red and a slot is free
    When a heavy run starts
    Then it runs
    Because red throttles admission, it does not stop the machine working

  # --- A tightened ceiling, only where it is earned ---

  @unit @unimplemented
  Scenario: An agent on the short-lived cache is not held past its floor
    Given an agent-driven run in a session whose cache writes went to the short-lived cache
    When it waits for a slot
    Then the wait is capped below that floor
    And when the cap is reached it proceeds rather than waiting longer

  @unit @unimplemented
  Scenario: An interactive run keeps the long failsafe in every regime
    Given a run started from a terminal
    When it waits for a slot
    Then the thirty-minute failsafe applies
    Because a human waiting is not an idle API session

  @unit @unimplemented
  Scenario: A run that reached its wait cap says what happened
    Given an agent-driven run that waited up to a tightened cap
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

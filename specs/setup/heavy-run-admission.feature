Feature: Heavy runs are admitted, narrowed, or refused
  As a developer whose laptop runs several worktrees and around ten agents at once
  I want a short test run to start narrower rather than wait, a long one to queue,
  and neither to be admitted when the machine cannot take it
  So that N parallel vitest runs never take the machine down, and no agent is held
  idle long enough to lose a prompt cache it could have kept

  # Extends specs/setup/check-slots.feature, which put `typecheck`, `lint` and
  # `format` behind one machine-wide counter in dev/scripts/check-queue.mjs.
  # That spec and that script arrive with PR #6598, which is OPEN AND UNMERGED
  # at the time of writing — this feature is stacked on it and neither the file
  # reference above nor the scenarios below resolve until it lands. Three gaps
  # are closed here. See ADR-087 for the precedence table these scenarios are
  # rows of.
  #
  # 1. TESTS WERE NOT ON THE COUNTER, and they are the larger problem. Measured
  # mid-session on an 11-core / 18 GiB machine: 17 node processes, 550-712 MB
  # each, PIDs inside a 250-PID range — one simultaneous burst of about 10.5 GB,
  # alongside an 8 GB colima VM. Those are vitest workers under `pool:
  # "vmForks"`, which platform/app/vitest.config.ts picks deliberately and
  # measures at 573 MB per fork — which is what the observed range is.
  # `maxWorkers: "50%"` is 5 workers PER RUN on 11 cores, so three or four
  # agents testing at once is 15-20 workers. The guardrail is per-run and does
  # exactly what it says; there was no machine-wide one.
  #
  # 2. THE LIMIT WAS DERIVED FROM TOTAL RAM, which the process does not have.
  # One slot per 6 GiB of os.totalmem() counts the 8 GiB inside the colima VM.
  #
  # 3. A WAIT COULD COST MORE THAN IT SAVED. A blocked tool call issues no API
  # requests and the prompt cache expires on idle with a 5-minute floor, so a
  # parked agent re-reads its conversation at the cache-write rate of 1.25x base
  # input instead of the cache-read rate of 0.1x — a 1.15x premium on the whole
  # prefix.
  #
  # BUT A RUNNING TOOL CALL ISSUES NO API REQUESTS EITHER. A narrowed run that
  # takes ten minutes loses the cache exactly like a six-minute park. So the
  # cache only decides anything for runs that finish INSIDE the floor; above it
  # the cache is forfeit either way and queueing is strictly better for the
  # machine. That is why narrowing below is always conditioned on the projected
  # duration, and why an unobserved command queues rather than narrows.
  #
  # Duration comes from a rolling observation haven keeps per command. There is
  # no estimation heuristic and no guess: unobserved means unknown means queue.

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

  # --- Narrowing, and its one condition ---

  @unit @unimplemented
  Scenario: A short run with no slot free is narrowed and started
    Given pressure is amber and no slot is free
    And this command has been observed to finish inside the cache floor when narrowed
    When a unit test run starts
    Then it is given a smaller worker count
    And it starts immediately rather than waiting

  @unit @unimplemented
  Scenario: A long run is queued rather than narrowed
    Given pressure is amber and no slot is free
    And this command has been observed to take longer than the cache floor
    When a unit test run starts
    Then it waits for a slot instead of being narrowed
    Because its cache is lost either way, and queueing is better for the machine

  @unit @unimplemented
  Scenario: A command haven has never seen is treated as long
    Given a command with no recorded duration
    When it finds no free slot
    Then it queues rather than narrowing
    Because the conservative direction is the one that cannot make the machine worse

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
    And the narrowing path never applies to it

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

  # --- Waits are bounded for agents, not for people ---

  @unit @unimplemented
  Scenario: An agent-driven run is never held past the cache floor
    Given a run whose caller is an agent
    When it waits for a slot
    Then the wait is capped below the five-minute prompt-cache floor
    And when the cap is reached it proceeds rather than waiting longer

  @unit @unimplemented
  Scenario: An interactive run keeps the long failsafe
    Given a run started from a terminal
    When it waits for a slot
    Then the existing thirty-minute failsafe applies
    Because a human waiting is not an idle API session

  @unit @unimplemented
  Scenario: A run whose caller cannot be identified is treated as an agent
    Given a run whose provenance is unknown
    When it waits for a slot
    Then the agent cap applies
    Because misreading an agent as a human silently restores the thirty-minute park

  @unit @unimplemented
  Scenario: A run that reached its wait cap says what happened
    Given an agent-driven run that waited up to its cap
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

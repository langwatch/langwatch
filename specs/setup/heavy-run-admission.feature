Feature: Heavy runs are admitted, narrowed, or refused — never parked past the cache floor
  As a developer whose laptop runs several worktrees and around ten agents at once
  I want a test run to start narrower rather than wait, and to be refused outright
  when the machine cannot take it
  So that N parallel vitest runs never take the machine down, and no agent is ever
  held idle long enough to lose its prompt cache

  # Extends specs/setup/check-slots.feature, which put `typecheck`, `lint` and
  # `format` behind one machine-wide counter in dev/scripts/check-queue.mjs.
  # That spec and that script arrive with PR #6598, which is OPEN AND UNMERGED
  # at the time of writing — this feature is stacked on it and neither the file
  # reference above nor the scenarios below resolve until it lands. Three gaps
  # are closed here. See ADR-087.
  #
  # 1. TESTS WERE NOT ON THE COUNTER, and they are the larger problem. Measured
  # mid-session on an 11-core / 18 GiB machine: 17 node processes, 24 threads
  # each, 550-712 MB each, PIDs inside a 250-PID range — one simultaneous burst
  # of about 10.5 GB, alongside an 8 GB colima VM. Those are vitest vmThreads
  # workers. `maxWorkers: "50%"` is 5 workers PER RUN on 11 cores, so three or
  # four agents testing at once is 15-20 workers. The guardrail is per-run and
  # does exactly what it says; there was no machine-wide one.
  #
  # 2. THE LIMIT WAS DERIVED FROM TOTAL RAM, which the process does not have.
  # One slot per 6 GiB of os.totalmem() counts the 8 GiB sitting inside the
  # colima VM as available. The limit now comes from what is actually free and
  # from live pressure (specs/setup/memory-pressure-governor.feature).
  #
  # 3. A WAIT COULD COST MORE THAN IT SAVED. CHECK_QUEUE_MAX_WAIT_MS defaults to
  # 30 minutes. A blocked tool call issues no API requests, and the prompt cache
  # expires on idle with a 5-minute floor, so an agent parked 6 minutes returns
  # to a cold cache and re-reads its whole conversation at cache-write rates
  # (1.15x base input) instead of cache-read (0.1x). Across ten agents that
  # costs more than the RAM the wait protects. Hence: narrow first, deny second,
  # wait only when the wait provably fits.
  #
  # The 30-minute failsafe stays for interactive callers — a human waiting at a
  # terminal is not an idle API session.

  # --- Tests join the existing counter ---

  @unit @unimplemented
  Scenario: A test run counts against the same slots as a typecheck
    Given the limit is 1 and a typecheck is already running
    When a unit test run starts
    Then it does not run its command yet
    And the two never run at the same time, because they compete for the same cores and RAM

  @unit @unimplemented
  Scenario: Every heavy script routes through the counter
    When I read the package scripts for test:unit and test:integration
    Then each one goes through the shared check queue
    And a script that bypasses it is a failure, because one counter only holds if everything counts

  # --- Narrowing beats queueing ---

  # A 2-worker run that starts now beats a 5-worker run that starts in six
  # minutes, for RAM and for prompt cache alike. Narrowing is the primary lever;
  # queueing is the fallback for runs that cannot be divided.
  @unit @unimplemented
  Scenario: A test run under pressure is narrowed instead of queued
    Given the machine is under moderate memory pressure
    And no slot is free
    When a unit test run starts
    Then it is given a smaller worker count sized to what is actually free
    And it starts immediately rather than waiting

  @unit @unimplemented
  Scenario: The worker count divides by the runs allowed in flight
    Given several heavy runs may be in flight at once
    When a test run's worker count is resolved
    Then it is the per-run count divided by the number of concurrent runs allowed
    And it is never below one, because a run with no workers can never finish

  @unit @unimplemented
  Scenario: A run that cannot be narrowed still queues
    Given a typecheck, which is a single process with nothing to divide
    When it finds no free slot
    Then it queues as before
    And the narrowing path does not apply to it

  @unit @unimplemented
  Scenario: A caller's own worker count is respected
    Given a test command that already specifies its worker count
    When it goes through the queue
    Then the queue does not override what the caller asked for

  # --- Waits are bounded by the prompt-cache floor ---

  @unit @unimplemented
  Scenario: An agent-driven run is never held past the cache floor
    Given a run that an agent is driving
    When it has to wait for a slot
    Then the wait is capped well under the five-minute prompt-cache floor
    And when the cap is reached it proceeds narrowed rather than continuing to wait

  @unit @unimplemented
  Scenario: A wait is only started when it provably fits
    Given a queue deep enough that the estimated wait exceeds the cap
    When a run arrives
    Then it does not start a wait it cannot finish
    And control returns to the caller immediately

  @unit @unimplemented
  Scenario: An interactive caller keeps the long failsafe
    Given a run started from a terminal rather than by an agent
    When it waits for a slot
    Then the existing thirty-minute failsafe applies
    Because a human waiting is not an idle API session

  @unit @unimplemented
  Scenario: A run that gave up waiting says so
    Given a run that reached its wait cap
    When it proceeds anyway
    Then it reports how long it waited and that it was narrowed
    So a slow run is never mistaken for a hung one

  # --- Fail open ---

  @unit @unimplemented
  Scenario: An unreadable pressure signal admits at full width
    Given the pressure signal is missing or stale
    When a heavy run is admitted
    Then it is treated as an unloaded machine
    And nothing is narrowed or queued, because a governor that cannot read the machine must not throttle it

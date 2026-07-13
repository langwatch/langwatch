Feature: GroupQueue poison-group park guard
  As the LangWatch event-sourcing queue processing per-aggregate FIFO groups
  I want groups that repeatedly kill the worker process, and staged payloads
  too large to parse safely, to be parked into the blocked set at claim time
  So that one poisoned group degrades only itself instead of crash-looping
  every worker replica and stalling all tenants' queues.

  # Incident 2026-07-10: a single group accumulated ~2,000 recordLog jobs for
  # one trace. Processing it seized the worker event loop, the liveness probe
  # SIGTERM'd the pod before any retry/park code path could run, and the next
  # boot re-claimed the same group - a crash loop that survived every restart
  # and redeploy for 20+ hours. ADR-029/030 cap payloads at ENCODE time
  # (MAX_BLOB_BYTES); nothing guards the CLAIM/DECODE side, and job-level
  # retry accounting (JOB_RETRY_CONFIG, restageAndBlock after 25 attempts)
  # never fires when the process dies mid-job.
  #
  # Design:
  #   - Claim strikes: processWithRetries records a persistent per-group
  #     strike in Redis BEFORE decoding, and clears it on every code path
  #     where the process survives (success, retry, exhausted-park, transient
  #     re-stage, graceful drain). A blocked event loop cannot run signal
  #     handlers or clears, so only loop-killing crashes leave strikes behind.
  #   - Strikes select a SUSPECT, never park by themselves: every group
  #     co-in-flight with the killer dies with the same uncleared strike (up
  #     to globalConcurrency innocents per crash, redelivered as the same
  #     cohort after the active TTL), so counting cannot tell the poison from
  #     its bystanders.
  #   - Isolation: a suspect over the threshold runs SOLO in the worker -
  #     intake paused, every other in-flight job settled - behind an isolation
  #     marker written to Redis before any decode/handler work. A death during
  #     a marked solo run is attributable beyond doubt; the surviving marker
  #     parks the group on its next claim. A healthy bystander survives its
  #     solo run, clears marker and strikes, and never parks.
  #   - Decode size guard: staged values larger than the encode-side cap
  #     (legacy/bare payloads that predate or bypass envelope writes) are
  #     parked without being JSON.parsed; gunzip output is bounded so a
  #     compressed bomb cannot balloon past the cap either.
  #   - Parked groups use the existing ops surface (getBlockedSummary,
  #     unblockGroup, drainGroup) - no new operator concepts.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades

  Scenario: a group that dies during an isolation run is parked at its next claim
    Given a group whose staged job blocks the event loop until the process is killed
    And the group's isolation marker survived the worker's death
    When a worker claims the group again after a restart
    Then the group is moved to the blocked set before the job payload is decoded
    And the stored group error explains that the death happened in isolation
    And the staged job remains staged for operator inspection or replay
    And other groups continue to dispatch and process normally

  Scenario: a suspect group is run in isolation instead of being parked on strikes alone
    Given a group whose claim strikes exceed the poison threshold
    When a worker claims the group
    Then the group's job runs while no other job is in flight in the process
    And an isolation marker is written before the job runs and cleared after it settles
    And the group is not parked

  Scenario: a bystander that inherited strikes from another group's crashes heals
    Given a healthy group whose claim strikes exceed the poison threshold because it was co-in-flight with a poison group
    When a worker claims the group and its isolation run completes
    Then its claim strikes and isolation marker are cleared
    And the group is never moved to the blocked set

  Scenario: a second suspect defers while an isolation run is active
    Given one suspect group already running in isolation in the worker process
    And another group whose claim strikes exceed the poison threshold
    When the worker claims the second group
    Then the second group's job is re-staged with backoff instead of running
    And its claim strikes are preserved for a later isolation attempt

  Scenario: claim strikes are cleared when processing survives
    Given a group whose job is claimed and processed to completion
    When the same group is claimed again later
    Then its claim strike count starts from zero
    And the group is not parked

  Scenario: a failing-but-not-crashing job does not accumulate claim strikes
    Given a group whose job throws an error on every attempt
    When the job exhausts its retry budget
    Then the group is parked by the existing exhausted-retries path
    And the claim strikes recorded for the group have been cleared on each surviving attempt

  @unimplemented
  # The clear-on-survival semantics is exercised by the completion/failure
  # scenarios; a direct drain-mid-shutdown binding needs a close() harness.
  Scenario: graceful shutdown mid-job does not count as a poison strike
    Given a group whose job is in flight when the worker begins a graceful shutdown
    When the shutdown drains or abandons the in-flight job with the event loop alive
    Then the group's claim strike is cleared
    And the group is dispatched normally after the worker restarts

  Scenario: an oversized staged value is parked without being parsed
    Given a staged value whose serialized size exceeds the decode-side cap
    When a worker claims the group
    Then the group is moved to the blocked set without JSON-parsing the value
    And the stored group error names the observed size and the cap
    And the worker's event loop remains responsive throughout

  Scenario: an oversized coalesced sibling parks the group without losing the batch
    Given a group whose dispatched job is small but a coalesced sibling exceeds the decode-side cap
    When a worker claims the group and drains the sibling to fold it into the batch
    Then the group is moved to the blocked set without JSON-parsing the oversized sibling
    And the stored group error explains the batch was parked unparsed
    And the batch's other work is re-staged for operator inspection or replay instead of being dropped

  Scenario: the poison guard is disabled by setting the strike threshold to 0
    Given the strike-threshold kill switch is set to 0
    And a group has accumulated claim strikes at or above the former poison threshold
    When a worker claims the group
    Then the group is dispatched and processed instead of being parked
    And no claim strike is recorded or enforced for the group

  Scenario: a compressed staged value that would decompress past the cap is parked
    Given a staged envelope whose gzip body would inflate beyond the decode-side cap
    When a worker claims the group
    Then decompression stops at the bound instead of materializing the full value
    And the group is moved to the blocked set

  Scenario: a parked poison group can be unblocked by an operator
    Given a group parked by the poison guard
    When an operator unblocks the group via the ops surface
    Then its claim strikes are reset
    And its isolation-death marker is cleared
    And the group returns to normal dispatch

  Scenario: draining a parked poison group resets its claim strikes
    Given a group parked by the poison guard
    When an operator drains the group via the ops surface
    Then its claim strikes are reset
    And its isolation-death marker is cleared
    And a new job arriving under the same group id is dispatched normally

  Scenario: moving a parked poison group to the dead-letter queue resets its claim strikes
    Given a group parked by the poison guard
    When an operator moves the group to the dead-letter queue via the ops surface
    Then its claim strikes are reset
    And its isolation-death marker is cleared
    And a new job arriving under the same group id is dispatched normally

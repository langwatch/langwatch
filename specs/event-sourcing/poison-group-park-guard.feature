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
  #     handlers or clears, so only genuine loop-killers accumulate strikes.
  #     At claim, strikes >= threshold parks the group via the existing
  #     blocked-set mechanism with an explanatory stored error.
  #   - Decode size guard: staged values larger than the encode-side cap
  #     (legacy/bare payloads that predate or bypass envelope writes) are
  #     parked without being JSON.parsed; gunzip output is bounded so a
  #     compressed bomb cannot balloon past the cap either.
  #   - Parked groups use the existing ops surface (getBlockedSummary,
  #     unblockGroup, drainGroup) - no new operator concepts.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades

  Scenario: a group whose jobs repeatedly kill the worker is parked at claim
    Given a group whose staged job blocks the event loop until the process is killed
    And the group has accumulated claim strikes at or above the poison threshold
    When a worker claims the group again after a restart
    Then the group is moved to the blocked set before the job payload is decoded
    And the stored group error explains the park with the accumulated strike count
    And the staged job remains staged for operator inspection or replay
    And other groups continue to dispatch and process normally

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
    And the group returns to normal dispatch

  Scenario: draining a parked poison group resets its claim strikes
    Given a group parked by the poison guard
    When an operator drains the group via the ops surface
    Then its claim strikes are reset
    And a new job arriving under the same group id is dispatched normally

  Scenario: moving a parked poison group to the dead-letter queue resets its claim strikes
    Given a group parked by the poison guard
    When an operator moves the group to the dead-letter queue via the ops surface
    Then its claim strikes are reset
    And a new job arriving under the same group id is dispatched normally

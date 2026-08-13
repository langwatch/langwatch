Feature: GroupQueue poison-group park guard
  As the LangWatch event-sourcing queue processing per-aggregate FIFO groups
  I want groups that repeatedly kill the worker process, staged payloads too
  large to parse safely, and groups that fail on every attempt without ever
  draining, to be parked into the blocked set
  So that one poisoned group degrades only itself instead of crash-looping
  every worker replica or starving all tenants' queues.

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
  #   - Claim ownership: processWithRetries stamps the claiming worker's
  #     identity onto a per-group claim marker in Redis BEFORE decoding, and
  #     releases it on every code path where the process survives (success,
  #     retry, exhausted-park, transient re-stage, graceful drain). At claim,
  #     confirmed deaths >= threshold parks the group via the existing
  #     blocked-set mechanism with an explanatory stored error.
  #   - Confirmed deaths: every consumer publishes an `alive` beacon on a
  #     heartbeat and overwrites it with a `retired` tombstone when it shuts
  #     down gracefully. A leftover marker is booked as a death ONLY when its
  #     owner is in neither state. A live owner (slow job, or a release that
  #     never reached Redis), a retired owner, and the same worker re-claiming
  #     under a lapsed lease are all ordinary and count for nothing.
  #
  # Incident 2026-08-13: the guard above replaced one that counted claims and
  # subtracted a delete - a surviving strike WAS the death signal. That
  # inference is only sound if the delete is guaranteed, and it is not: it is
  # issued fire-and-forget, and process.exit(0) discards whatever Redis has not
  # yet read. Prod parked ~10 healthy groups a day that way, accelerating, each
  # one hours from the nearest deploy, on pods with zero restarts, for a job
  # whose p99 is 25ms and which had never once retried. Every operator unblock
  # succeeded on the first try because nothing was ever wrong with the group.
  # A death must therefore be evidenced by the absence of a live process, never
  # by the absence of a write.
  #   - Decode size guard: staged values larger than the encode-side cap
  #     (legacy/bare payloads that predate or bypass envelope writes) are
  #     parked without being JSON.parsed; gunzip output is bounded so a
  #     compressed bomb cannot balloon past the cap either.
  #   - Parked groups use the existing ops surface (getBlockedSummary,
  #     unblockGroup, drainGroup) - no new operator concepts.
  #
  # Incident 2026-07-20: a claudeCodeSpanSync reactor group for one trace churned
  # ~5 fresh jobs/min for 14h against a precondition that never became true, and
  # took ~a quarter of the shared {event-sourcing/jobs} queue's retry capacity.
  # The per-JOB retry cap (JOB_RETRY_CONFIG.maxAttempts) never fired because
  # every failure was a NEW attempt-1 job, not one job grinding to exhaustion, so
  # the group was immortal. This adds a THIRD guard:
  #   - Failure-streak quarantine: a per-group counter (recordGroupFailure)
  #     INCR'd on every retryable job failure and cleared on the group's next
  #     success. Counting failures ACROSS a group's jobs catches the runaway the
  #     per-job cap misses. Once the streak exceeds
  #     LANGWATCH_GQ_QUARANTINE_FAILSTREAK_THRESHOLD (default 500, 0 = disabled)
  #     the job is routed through the SAME exhausted-retries path that blocks the
  #     group, with a stored error naming the streak. High default: only a group
  #     failing this many times inside the TTL window with zero interleaved
  #     successes is an unambiguous runaway, never a healthy group riding out a
  #     transient blip.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades

  Scenario: a group whose jobs repeatedly kill the worker is parked at claim
    Given a group whose staged job blocks the event loop until the process is killed
    And the group has accumulated confirmed worker deaths at or above the poison threshold
    When a worker claims the group again after a restart
    Then the group is moved to the blocked set before the job payload is decoded
    And the stored group error explains the park with the confirmed death count
    And the staged job remains staged for operator inspection or replay
    And other groups continue to dispatch and process normally

  Scenario: claim markers are released when processing survives
    Given a group whose job is claimed and processed to completion
    When the same group is claimed again later
    Then its confirmed death count starts from zero
    And the group is not parked

  @integration
  Scenario: a claim left behind by a worker that is still running is not a death
    Given a group whose claim marker names a worker whose beacon is still live
    When another worker claims the group
    Then no death is recorded for the group
    And the group is dispatched and processed instead of being parked

  @integration
  Scenario: a claim left behind by a gracefully retired worker is not a death
    Given a group whose claim marker names a worker that published a retirement tombstone
    When another worker claims the group
    Then no death is recorded for the group
    And the group is dispatched and processed instead of being parked

  @integration
  Scenario: a claim left behind by a worker that vanished without retiring is a death
    Given a group whose claim marker names a worker with neither a beacon nor a tombstone
    When another worker claims the group
    Then one confirmed death is recorded for the group
    And the count accumulates across successive deaths until the group is parked

  @integration
  Scenario: a worker re-claiming its own lapsed lease is not a death
    Given a group whose claim marker names the same worker that is claiming it now
    When that worker claims the group again after its active lease lapsed
    Then no death is recorded for the group
    And the group is dispatched and processed instead of being parked

  @integration
  Scenario: a release that never reaches Redis does not park a healthy group
    Given a group whose job completed but whose claim release was lost
    When the group is claimed repeatedly beyond the poison threshold
    Then no death is recorded for any of those claims
    And the group is never parked into the blocked set

  Scenario: a failing-but-not-crashing job does not accumulate confirmed deaths
    Given a group whose job throws an error on every attempt
    When the job exhausts its retry budget
    Then the group is parked by the existing exhausted-retries path
    And the claim marker has been released on each surviving attempt

  Scenario: a group that fails on every attempt without draining is quarantined
    Given a group receiving a stream of fresh jobs that each fail on every attempt
    And no job in the group ever completes successfully
    When the group's consecutive-failure streak exceeds the quarantine threshold
    Then the group is moved to the blocked set via the exhausted-retries path
    And the stored group error explains it was quarantined after a run of failures
    And the staged job remains staged for operator inspection or replay
    And other groups continue to dispatch and process normally
    And the group's failure streak is cleared as it is parked, so an operator's
      unblock gets a fresh run instead of re-quarantining on the next failure

  Scenario: a group's success clears its failure streak
    Given a group that has accumulated a failure streak below the quarantine threshold
    When one of the group's jobs completes successfully
    Then the group's failure streak is cleared
    And a later transient failure starts the streak from zero rather than compounding

  Scenario: the failure-streak quarantine is disabled by setting the threshold to 0
    Given the quarantine kill switch is set to 0
    And a group whose jobs fail on every attempt far beyond the former threshold
    When the group is dispatched repeatedly
    Then the group is retried under the normal per-job budget instead of being quarantined
    And the group is never parked into the blocked set by the failure-streak guard

  @integration
  Scenario: graceful shutdown mid-job does not count as a poison strike
    Given a group whose job is in flight when the worker begins a graceful shutdown
    When the shutdown drains or abandons the in-flight job with the event loop alive
    Then the worker has published a retirement tombstone before the drain begins
    And the group records no death when it is claimed after the worker restarts

  @integration
  Scenario: the retirement tombstone outlives the claim markers it answers for
    Given a worker that retired while holding claims on several groups
    When one of those groups is claimed an hour later, within the claim marker's lifetime
    Then the tombstone still resolves the previous owner as retired rather than dead
    And no death is recorded for the group

  @unit
  Scenario: the liveness beacon stops before the retirement tombstone is written
    Given a worker whose beacon refresh is due as it begins shutting down
    When the worker retires
    Then no later refresh can overwrite the tombstone with a short-lived beacon

  Scenario: an oversized staged value is parked without being parsed
    Given a staged value whose serialized size exceeds the decode-side cap
    When a worker claims the group
    Then the group is moved to the blocked set without JSON-parsing the value
    And the stored group error names the observed size and the cap
    And the worker's event loop remains responsive throughout

  Scenario: an oversized coalesced sibling parks the group without losing the batch
    Given a group whose dispatched job is small but a staged sibling exceeds the decode-side cap
    When a worker claims the group and coalesces a batch
    Then the oversized sibling is never folded into the batch
    And the batch's other work completes normally instead of being held behind the poison
    And when the oversized sibling's own turn comes, the group is moved to the blocked set without JSON-parsing it
    And the stored group error explains why it was parked

  Scenario: the poison guard is disabled by setting the strike threshold to 0
    Given the strike-threshold kill switch is set to 0
    And a group has accumulated confirmed deaths at or above the former poison threshold
    When a worker claims the group
    Then the group is dispatched and processed instead of being parked
    And no claim marker is recorded or enforced for the group

  Scenario: a compressed staged value that would decompress past the cap is parked
    Given a staged envelope whose gzip body would inflate beyond the decode-side cap
    When a worker claims the group
    Then decompression stops at the bound instead of materializing the full value
    And the group is moved to the blocked set

  Scenario: a parked poison group can be unblocked by an operator
    Given a group parked by the poison guard
    When an operator unblocks the group via the ops surface
    Then its confirmed death count is reset
    And the group returns to normal dispatch

  @integration
  Scenario: parking a group releases its claim marker
    Given a group being parked by the poison guard
    When the park completes
    Then the group's claim marker is released rather than left at the threshold
    And an operator who unblocks within the marker's lifetime gets a fresh run
      instead of the group re-parking on its very next claim

  Scenario: draining a parked poison group resets its confirmed death count
    Given a group parked by the poison guard
    When an operator drains the group via the ops surface
    Then its confirmed death count is reset
    And a new job arriving under the same group id is dispatched normally

  Scenario: moving a parked poison group to the dead-letter queue resets its confirmed death count
    Given a group parked by the poison guard
    When an operator moves the group to the dead-letter queue via the ops surface
    Then its confirmed death count is reset
    And a new job arriving under the same group id is dispatched normally

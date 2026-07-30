# Design: dev/docs/adr/108-the-dispatch-plane.md
Feature: The Redis lane queue stages, claims, retries and parks one lane at a time
  packages/groupqueue is the Redis implementation of the LaneQueue and
  BlobSpool ports (ADR-108 decisions 4, 6, 9, 10; ADR-110 decision 1). A lane
  is one Redis sorted set, scored by the ordering key the caller supplies;
  staging assigns the lane's next sequence in the same atomic step that
  inserts the job, using the renderer in
  packages/event-sourcing/src/dispatch/groupKey.ts so every key one script
  touches shares that lane's hash tag.

  Fairness — which lane a consumer claims from next — is
  packages/event-sourcing/src/runtime/scheduler.ts's job, not this package's.
  What is here is the per-lane mechanics a scheduler or a bare consumer can
  rely on: an atomic claim bounded by count and by bytes, a lease that
  expires without losing what it was claiming, a park flag one lane at a
  time, and a content-addressed spool for bodies too large to keep inline.

  Background:
    Given a Redis-backed lane queue

  Rule: A sequence is assigned in the same atomic step that inserts the job

    @integration
    Scenario: Two jobs staged into one lane get increasing sequences
      When two jobs are staged into the same lane
      Then the second carries a higher sequence than the first

    @integration
    Scenario: A job's header is stored apart from its body
      Given a job staged with a large body
      When its header is read back directly, without touching the body's own key
      Then the header decodes and reports the job's sequence

    @integration
    Scenario: Two lanes do not share a sequence space
      When a job is staged into one lane and another into a different lane
      Then each is assigned sequence one, within its own lane

  Rule: A retry presents the sequence it was first staged with, and preserves the attempt chain

    @integration
    Scenario: A retried job's header still carries its original sequence
      Given a job that has been staged and then claimed
      When the queue retries it and it is claimed again
      Then its header carries the same sequence it was staged with

    @integration
    Scenario: Backoff preserves the attempt across the retry chain
      Given a job that has failed and been retried once already
      When it fails again and is retried a second time
      Then its attempt has advanced by one each time, not reset

  Rule: A leased lane is not claimed twice, and an expired lease reclaims without losing the attempt

    @integration
    Scenario: A second claim on an already-leased lane is refused
      Given a lane whose only job has just been claimed
      When another claim is attempted before the first is settled
      Then the second claim returns nothing for that lane

    @integration
    Scenario: An expired lease's lane is claimable again without losing its attempt
      Given a lane whose job was retried once and then claimed under a short lease
      When the lease expires without being settled, retried or parked
      Then the lane can be claimed again
      And the reclaimed job still carries the attempt it had before the lease expired

  Rule: A claim is bounded by count and by bytes

    @integration
    Scenario: A claim stops at the configured job count
      Given a lane holding more jobs than the requested count bound
      When a claim requests fewer jobs than the lane holds
      Then only the requested count is returned

    @integration
    Scenario: A claim stops short of the byte bound rather than exceeding it
      Given a lane holding several jobs whose combined size exceeds a byte bound
      When a claim is made with that byte bound
      Then the returned batch's total size does not exceed the bound

    @integration
    Scenario: A single job larger than the byte bound is still claimed alone
      Given a lane whose only job exceeds the configured byte bound
      When a claim is made
      Then that job is claimed by itself

  Rule: Parking a lane stops only that lane

    @integration
    Scenario: A parked lane is never returned by a claim
      Given a lane that has been parked with a reason
      When a claim is attempted
      Then that lane's job is never returned

    @integration
    Scenario: Parking one lane does not stop another lane's work
      Given one lane that has been parked and a second lane with its own job
      When a claim is attempted
      Then the second lane's job is returned

  Rule: A tenant over its configured in-flight cap is skipped, and the scan keeps going

    # This is a defense-in-depth circuit breaker at the substrate itself, not
    # a replacement for scheduler.ts's own fuller fairness policy (round-robin
    # across tenants, per-lane-kind budgets — dispatch-durability-and-fairness
    # .feature). It is opt-in (0 disables it) and answers only one question:
    # a tenant already holding `tenantSoftCap` leased lanes has its remaining
    # lanes skipped by claim() rather than starving every other tenant's
    # backlog while that one is served exclusively.

    @integration
    Scenario: A tenant already at its configured in-flight cap has its other lanes skipped
      Given a tenant with two lanes and a soft cap of one
      And that tenant's first lane has just been claimed
      When a claim is attempted again
      Then the tenant's second lane is not returned

    @integration
    Scenario: A tenant back under its cap is claimable again without a separate reset
      Given a tenant at its soft cap whose claimed lane is then settled
      When a claim is attempted again
      Then the tenant's other lane is claimable

    @integration
    Scenario: A soft cap of zero disables the tenant cap
      Given a tenant with two lanes and no configured soft cap
      When both lanes are claimed in turn
      Then neither claim is skipped for being over a cap

  Rule: Settling a job removes it durably, which is what makes a drop permanent

    # The queue never decodes a job's body and never decides whether a
    # failure is transient or a permanent drop — that classification is the
    # consumer's (specs/event-sourcing/dispatch-durability-and-fairness.feature,
    # "A job whose body cannot be decoded is dropped durably, not retried
    # forever"). What the queue owns is the other half: once the consumer
    # calls settle() — on success or on a drop — the job is gone and cannot
    # be claimed again, so a drop cannot be re-delivered as if it were still
    # pending.

    @integration
    Scenario: A settled job is never claimed again
      Given a job that has been claimed and then settled
      When a claim is attempted on that lane afterward
      Then nothing is returned, because the lane is empty

  Rule: NOSCRIPT after a Redis restart recovers instead of failing the caller

    @unit
    Scenario: A NOSCRIPT reply falls back to EVAL with the cached source
      Given a Redis client that raises NOSCRIPT on evalsha
      When the cached script runs
      Then it retries with EVAL and returns the result
      And a plain non-NOSCRIPT error is not retried

    @integration
    Scenario: Staging still works after the server's script cache is flushed
      Given a lane queue that has already run its scripts once
      When the Redis server's script cache is flushed
      And another job is staged
      Then it is staged successfully

  Rule: A spooled blob's content id is tenant-namespaced and branded at construction

    @unit
    Scenario: A tenant id containing the key separator is refused
      When a blob is put with a tenant id containing "/"
      Then the spool refuses it rather than constructing a colliding key

  Rule: A large body round-trips through the spool byte-identically

    @integration
    Scenario: A body larger than the inline threshold is stored and read back unchanged
      Given a body larger than the spool's Redis-tier threshold
      When it is put into the spool and then read back
      Then the returned body is byte-for-byte identical to the original

    @integration
    Scenario: A body over the hard ceiling is refused
      Given a body larger than the spool's hard size ceiling
      When it is put into the spool
      Then the spool refuses it

  Rule: A blob's lifetime is the set of jobs holding it

    @integration
    Scenario: A blob still held by another job is not deleted on release
      Given a blob put into the spool by two holders
      When one holder releases it
      Then the blob is still readable

    @integration
    Scenario: A released blob is still readable before its grace window elapses
      Given a blob released by its only holder
      When it is read back before the grace window elapses
      Then the blob is still readable

    @integration
    Scenario: A released blob is reclaimed once its grace window elapses
      Given a blob released by its only holder
      When it is read back after the grace window elapses
      Then the blob is no longer readable

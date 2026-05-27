Feature: Pending counter conservation across job lifecycle
  As an operator monitoring the ops dashboard
  I want the total-pending counter to accurately reflect jobs in :jobs ZSETs
  So that the dashboard shows real queue depth, not phantom drift.

  # Why this exists — incident 2026-05-21
  #
  # The total-pending counter drifted to 827K (real pending was ~1,300).
  # Root cause: COMPLETE_LUA only DECRs the counter when the activeKey
  # matches the stagedJobId. When the activeKey expires before the worker
  # calls COMPLETE, the DECR is silently skipped. The INCR at stage time
  # has no compensating DECR, so the counter only ever goes up.
  #
  # Fix: move DECR to DISPATCH (job leaves :jobs ZSET — always succeeds)
  # and add compensating INCRs in RETRY_RESTAGE and RESTAGE_AND_BLOCK
  # (job re-enters :jobs ZSET). COMPLETE no longer touches the counter.

  Background:
    Given the GroupQueue is running with Lua scripts deployed

  @integration @counter @lifecycle
  Scenario: Counter tracks jobs in :jobs ZSETs through happy path
    Given a staged job for tenant "proj_acme" (INCR at stage)
    When DISPATCH removes the job from :jobs
    Then the counter is decremented (DECR at dispatch)
    When COMPLETE runs successfully
    Then the counter is unchanged (no DECR in COMPLETE)

  @integration @counter @active-expiry
  Scenario: Counter stays accurate when activeKey expires before COMPLETE
    Given a staged job for tenant "proj_acme" (INCR at stage)
    When DISPATCH removes the job from :jobs (DECR at dispatch)
    And the activeKey expires before the worker completes
    And COMPLETE returns 0 (stale active key)
    Then the counter is still accurate (DECR already happened at dispatch)

  @integration @counter @retry
  Scenario: Counter tracks retry restage as a new pending job
    Given a dispatched job (counter was decremented at dispatch)
    When RETRY_RESTAGE re-stages the job with a future score
    Then the counter is incremented (job re-enters :jobs ZSET)
    When DISPATCH picks up the retried job
    Then the counter is decremented again

  @integration @counter @block
  Scenario: Counter tracks restage-and-block as a new pending job
    Given a dispatched job (counter was decremented at dispatch)
    When RESTAGE_AND_BLOCK re-stages with a new ID and blocks the group
    Then the counter is incremented (job re-enters :jobs ZSET)

  @integration @counter @invariant
  Scenario: Counter equals sum of all :jobs ZSET cardinalities
    Given multiple tenants with staged, dispatched, and retried jobs
    When the system reaches a quiescent state
    Then total-pending equals the sum of ZCARD across all group :jobs ZSETs

  @integration @counter @coalescing
  Scenario: Draining siblings for coalescing decrements pending per job
    Given a group with several staged jobs (INCR at stage)
    When the coalescing path drains some of them in one call
    Then the counter is decremented once per drained job (same as dispatch)

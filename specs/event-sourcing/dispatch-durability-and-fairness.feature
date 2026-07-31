# Design: dev/docs/adr/108-the-dispatch-plane.md
Feature: The scheduler is one fair policy, and undecodable work never blocks a lane
  Work-conserving fair dispatch, per-tenant soft caps and poison-lane parking
  were three subsystems with three spec files. They are three questions asked
  of the same decision — which lane next? — and this feature is that one
  policy: round-robin across tenants, skip a leased lane, skip a tenant over
  its soft cap and keep going, skip a parked lane, and consult one `enabled`
  predicate before selecting at all (ADR-108 decision 5, decision 13).

  # Why this supersedes the adaptive water-level design
  # (event-sourcing/work-conserving-fair-dispatch.feature)
  #
  # That file's model computed a recomputed scalar water-level across a fleet
  # of pods, filled by demand, to approximate a max-min fair share under
  # asymmetric load. ADR-108 does not carry that model forward: the policy
  # below is a stateless function re-evaluated on every call from whatever
  # counters the caller supplies, so there is no water-level to recompute, no
  # demand-recency set to age out, and no "restore a parked group" step —
  # a tenant that drops back under its cap is simply eligible again on the very
  # next call. What survives is the property the water-level existed to
  # produce: idle capacity is never left behind a throttle, and a tenant over
  # its cap is skipped without stopping any other tenant's work.

  The queue itself is not this feature's concern — it is a pure function over
  a lane index and per-tenant counters, with no I/O, so every scenario below
  runs without Redis (ADR-108 decision 5).

  The second half of this feature is the consumer's decode step. A job body
  that cannot be decoded is not a transient fault to retry into the ground —
  it is recorded and dropped durably, while a body that is merely temporarily
  unreachable still retries. Confusing the two used to mean either an
  unrecoverable body was retried forever, or a recoverable one was destroyed on
  the way out (`event-sourcing/groupqueue-decode-drop-durability.feature`).

  Background:
    Given a consumer draining lanes through a scheduler and an executor per lane kind

  Rule: Round-robin across tenants keeps capacity work-conserving

    @unit
    Scenario: A single tenant with eligible lanes is served on every call
      Given only one tenant has eligible lanes
      When the scheduler selects repeatedly
      Then that tenant's lanes are selected every time
      And selection never returns nothing while an eligible lane remains

    @unit
    Scenario: Two tenants with eligible lanes are each served in turn
      Given two tenants each have an eligible lane
      When the scheduler selects repeatedly
      Then both tenants are selected before either is selected a second time

    @unit
    Scenario: A tenant with no eligible lanes is skipped without being asked again
      Given one tenant has no eligible lanes and another does
      When the scheduler selects
      Then the tenant with an eligible lane is the one selected

    @unit
    Scenario: A tenant's own lanes keep the order they were given
      Given a tenant has several eligible lanes in a declared priority order
      When the scheduler selects among that tenant's lanes
      Then it selects them in the order they were given
      And fairness only reorders selection across tenants, never within one

  Rule: A tenant over its soft cap is skipped, and the scan keeps going

    @unit
    Scenario: A tenant at its soft cap is skipped while another tenant is served
      Given one tenant is at its configured soft cap and has more eligible lanes
      And a second tenant has one eligible lane and is under its cap
      When the scheduler selects
      Then the second tenant's lane is selected
      And no lane is selected for the tenant at its cap

    @unit
    Scenario: A tenant under its soft cap is never skipped for being large
      Given a tenant already holds more in-flight lanes than another tenant
      But it is still under its own configured soft cap
      When the scheduler selects
      Then that tenant's lane is still eligible for selection

    @unit
    Scenario: A tenant drops back under its cap and is immediately eligible again
      Given a tenant was over its soft cap and is now reported back under it
      When the scheduler selects on the very next call
      Then that tenant's lane is eligible, with no separate restore step

    @unit
    Scenario: A soft cap of zero disables the cap for that tenant
      Given a tenant's soft cap is configured as zero
      And that tenant already holds many in-flight lanes
      When the scheduler selects
      Then that tenant's lanes remain eligible regardless of how many are in flight

  Rule: A leased lane is never selected twice, and a parked lane is skipped

    @unit
    Scenario: A leased lane is skipped in favor of an unleased one
      Given a tenant's only eligible-looking lane is currently leased
      And another tenant has an unleased lane
      When the scheduler selects
      Then the unleased lane is selected
      And the leased lane is not

    @unit
    Scenario: A parked lane is skipped without stopping its tenant's other lanes
      Given a tenant has one parked lane and one healthy lane
      When the scheduler selects
      Then the healthy lane is selected
      And the parked lane is never returned

  Rule: An operator's enabled predicate is consulted before a lane is offered

    @unit
    Scenario: A disabled lane is never selected by the scheduler
      Given a lane the operator predicate reports as disabled
      And another tenant's lane the predicate allows
      When the scheduler selects
      Then the allowed lane is selected and the disabled one never is

    @unit
    Scenario: A lane claimed just as it becomes disabled is put back unexecuted
      Given a consumer has just claimed a batch for a lane
      And the operator predicate now reports that lane as disabled
      When the consumer checks the predicate before executing
      Then the batch is put back for redelivery without being decoded or executed

  Rule: A claim is bounded by count and by bytes, and a consumer bounds its own in-flight work

    @unit
    Scenario: A claim stops adding jobs once the byte bound would be exceeded
      Given a lane holding several jobs whose combined size exceeds the byte bound
      When the consumer claims a batch
      Then the batch stops short of the byte bound rather than exceeding it

    @unit
    Scenario: A single job larger than the byte bound is still claimed alone
      Given a lane whose first job alone exceeds the byte bound
      When the consumer claims a batch
      Then that job is claimed by itself rather than never being claimable

    @unit
    Scenario: A consumer does not exceed its configured in-flight budget
      Given a consumer configured with a maximum number of in-flight batches
      When more eligible lanes exist than that budget allows
      Then the consumer never holds more claimed batches than its budget at once

  Rule: Execution differs by lane kind, and a batch produces at most one durable effect

    @unit
    Scenario: A fold's batch is applied as one left-fold over its events
      Given a claimed batch of events for a fold lane
      When the consumer executes it
      Then the fold applies the whole batch in one call, in the batch's order

    @unit
    Scenario: A map's batch is written as one bulk write
      Given a claimed batch of events for a map lane
      When the consumer executes it
      Then the map writes the whole batch in one call rather than one write per event

    @unit
    Scenario: A subscriber's failure is logged and settled, never retried
      Given a claimed batch for a subscriber lane whose handler throws
      When the consumer executes it
      Then the failure is recorded
      And the batch is settled rather than retried or parked

    @unit
    Scenario: A process manager's batch produces one emission, not one per event
      Given a claimed batch of several events for a process manager lane
      When the consumer executes it
      Then exactly one set of intents is staged for the whole batch

  Rule: A lane parks after its configured number of consecutive failures

    @unit
    Scenario: A lane parks once its consecutive-failure budget is spent
      Given a lane whose executor fails on every attempt
      When it fails as many times in a row as its configured budget allows
      Then the lane is parked and its stored reason names the run of failures
      And the lane's tenant is otherwise unaffected

    @unit
    Scenario: A success clears a lane's consecutive-failure count
      Given a lane that has failed some times, fewer than its parking budget
      When one of its batches succeeds
      Then its consecutive-failure count returns to zero
      And a later failure is counted from zero rather than compounding

    @unit
    Scenario: A parking budget of zero disables parking for that lane
      Given a lane configured with a parking budget of zero
      When it fails far more times in a row than the former default budget
      Then it is retried under the normal backoff rather than being parked

  Rule: An operator's recovery clears every counter that outlived the block

    # This is the one Rule in this feature the dispatch runtime does not
    # implement. The counters live in Redis, and unblocking, draining or
    # dead-lettering a group is an operator action against that storage
    # directly (`platform/app/.../ops/repositories/queue.redis.repository.ts`),
    # not a call through `LaneQueue`. It is kept here rather than dropped
    # because it is the same lane-lifecycle story as parking above: an
    # operator recovering a lane is asking for another run, not for the
    # ladder to resume one rung from its end, and every counter that decides
    # whether a run is allowed has to go — the strike count, the retry
    # chain, and the consecutive-failure streak alike.

    @integration
    Scenario: A group unblocked after exhaustion retries instead of re-blocking on its first failure
      Given a group blocked after a job used up its retry budget
      When an operator unblocks it and the job fails once more
      Then the job is retried rather than the group being blocked again

    @integration
    Scenario: A group unblocked after exhaustion is not immediately re-quarantined by its old failure streak
      Given a group blocked after a long run of consecutive failures
      When an operator unblocks it and its next job fails once
      Then the group is not quarantined on that single failure

    @integration
    Scenario: An unblocked group's fresh ladder does not depend on how long the operator waited
      Given two groups blocked after exhaustion
      When one is unblocked immediately and the other much later
      Then both get the same retry budget on their next run

    @integration
    Scenario: A drained group id starts its next job on a fresh ladder
      Given a group blocked after a job used up its retry budget
      When an operator drains it and a new job arrives under the same group id
      Then that job gets the full retry budget
      And it is not quarantined by the drained group's failure streak

    @integration
    Scenario: A dead-lettered group id starts its next job on a fresh ladder
      Given a group blocked after a job used up its retry budget
      When an operator moves it to the dead-letter queue and a new job arrives under the same group id
      Then that job gets the full retry budget
      And it is not quarantined by the dead-lettered group's failure streak

  Rule: A job whose body cannot be decoded is dropped durably, not retried forever

    @unit
    Scenario: An undecodable job is recorded and settled, not retried
      Given a claimed batch containing one job whose body fails to decode
      When the consumer decodes the batch
      Then that job is recorded as a drop
      And it is never re-staged for another attempt

    @unit
    Scenario: An undecodable sibling does not hold back the rest of its batch
      Given a claimed batch where one job's body fails to decode and the rest decode fine
      When the consumer executes the batch
      Then the decodable jobs are executed and the batch settles normally
      And the undecodable job is recorded as a drop, not executed

    @unit
    Scenario: A batch that is entirely undecodable settles as empty rather than parking
      Given a claimed batch whose every job fails to decode
      When the consumer decodes the batch
      Then the batch is settled
      And the lane is not parked merely for having held undecodable jobs

    @unit
    Scenario: A drop leaves the lane live for its next job
      Given a lane whose only staged job cannot be decoded
      When the consumer drops it
      Then the next job staged under the same lane is claimed and processed normally

  Rule: A drop is classified by the failure's type, not by matching its message text

    @unit
    Scenario: A job whose blob reference resolves to nothing is classified as missing
      Given a job whose blob reference the spool no longer holds
      When the consumer resolves its body
      Then the drop is classified as a missing blob
      And the spool's holder for that reference is released

    @unit
    Scenario: A job whose resolved body is not valid is classified as malformed, and its blob is kept
      Given a job whose blob reference resolves to a body that fails to parse
      When the consumer resolves and decodes it
      Then the drop is classified as malformed
      And the spool's holder for that reference is not released

    @unit
    Scenario: Classification does not depend on matching the underlying exception's message
      Given a missing blob and a malformed body that both raise exceptions with unrelated text
      When each is classified
      Then the two are told apart by which failure occurred, not by their messages

  Rule: A transient failure to resolve a body still retries; only its exhaustion is a durable loss

    @unit
    Scenario: A body that is temporarily unreachable retries instead of being dropped
      Given a job whose blob reference resolution rejects with a transient error
      When the consumer tries to resolve it
      Then the batch is retried rather than recorded as a drop

    @unit
    Scenario: A body that stays unreachable for the whole retry budget is a counted loss
      Given a job whose blob reference resolution keeps rejecting on every retry
      When its retry budget is spent
      Then it is recorded as a drop with a transient-exhausted reason

  Rule: A drop is never mistaken for a completed job

    @unit
    Scenario: Dropping a job does not increment the count of completed work
      Given a lane whose completed-batch count is known
      When a batch is dropped rather than executed
      Then the completed-batch count is unchanged

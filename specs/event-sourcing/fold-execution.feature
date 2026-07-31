# Design: dev/docs/adr/107-the-pipeline.md (decisions 6-11),
# dev/docs/adr/108-the-dispatch-plane.md (decisions 7-8),
# dev/docs/adr/109-storage.md (decision 2).
#
# Merges the former fold-read-back-store, fold-read-window, fold-coalescing,
# fold-store-library and redis-fold-cache features. Scenarios those files
# carried for AppliedEventIds, refold-on-miss and refold-on-out-of-order are
# not carried forward as @unimplemented: ADR-107 removes those mechanisms
# rather than deferring them, and requires a fold to be a function of the SET
# of its events instead.

@unit
Feature: A fold reads its own state back, applies a batch, and writes it once
  Every fold shares one cycle: read what is there, apply the delivery, write the
  result. Two things make that cycle safe, and neither is a queue guarantee.

  The first is what a fold does when it cannot read the row it found. An
  undecodable row and an aggregate that has never been seen look identical from
  the outside, and only one of them is safe to overwrite. Collapsing them turns a
  shape change into a silent, population-wide reset — every aggregate starts over
  from a fresh accumulator, stamped as current, with no trace of what it
  replaced, and the row reads clean afterwards.

  The second is that a fold is a function of the set of events it has seen, not
  of their order or their multiplicity. So there is no applied-event set, no
  sequence column on the row, and no skip branch: a redelivered batch is applied
  again and reaches the state it already had. That is a requirement on the fold,
  which the order-invariance check enforces, rather than a hope about delivery.

  Background:
    Given a fold declared with a genesis state and a rule for applying an event
    And a durable store fronted by a cache

  # ── genesis, read-back, and the three read outcomes ──

  Scenario: the first delivery for an aggregate starts from genesis
    Given no state has ever been stored for this aggregate
    When a delivery arrives for that aggregate
    Then the fold starts from its genesis state
    And every event in the delivery is applied on top of it
    And the resulting state is written to the store
    And the event log is not read

  Scenario: a later delivery folds onto the stored state
    Given an aggregate that already has a stored state
    When a further delivery arrives for that aggregate
    Then the new events are applied on top of the stored state
    And what the stored state already held is carried forward

  Scenario: a cold cache recovers from the fold's own row, never from the event log
    Given an aggregate whose state was already committed
    And its cached state has expired
    When the next event for that aggregate arrives
    Then the fold recovers the committed state from its own store
    And it does not replay the aggregate's history from the event log

  Scenario: a fold whose row is a slimmed summary still recovers its working state
    Given a fold whose stored row keeps only the columns an analytics query needs
    And whose working state tracks more than those columns show
    When its cached state has expired and the next event arrives
    Then the fold recovers its full working state from its own row
    And a late dimension-only signal still lands on the recovered state

  Scenario: reading a row back and re-projecting it is a fixed point
    Given an aggregate whose state was committed by the fold as it stands today
    When the state is read back and projected again with no new events
    Then the row produced is identical to the row already stored

  Scenario: an unreadable row is never treated as an aggregate that has never been seen
    Given a stored row for this aggregate that the current build cannot decode
    When a delivery arrives for that aggregate
    Then the fold refuses to treat the unreadable row as absent
    And it fails loudly rather than starting from a fresh accumulator
    And nothing is written to the store
    And the failure names the projection, the aggregate and the shape that could not be read

  Scenario: a genuinely missing row is genesis, and an undecodable one is not
    Given two aggregates, one with no row at all and one with a row this build cannot decode
    When a delivery arrives for each
    Then the one with no row starts from genesis and is written
    And the one with an undecodable row fails and is left as it is

  # ── the cache tier: a latency tier, never a durability mechanism ──

  Scenario: a cached entry is served without reading the durable store
    Given the fold state for this aggregate is cached
    When the fold reads its state
    Then the cached state is returned
    And the durable store is not read

  Scenario: a cache miss falls through to the durable store
    Given the fold state for this aggregate is not cached
    And the durable store holds state for it
    When the fold reads its state
    Then the state is returned from the durable store

  Scenario: an unreadable cache entry is a miss, not a failure
    Given the cached entry for this aggregate cannot be read back
    When the fold reads its state
    Then the durable store is read instead
    And the delivery is not failed, because the state is durable

  Scenario: an unreachable cache does not fail a delivery
    Given the cache cannot be reached at all
    When a delivery is applied
    Then the state is read from the durable store and the delivery succeeds
    And the miss is counted

  Scenario: the durable store is written before the cache, always
    When a delivery is applied
    Then the durable store is written first
    And only then is the cache written

  Scenario: a failed cache write deletes the key rather than leaving what is there
    Given a cache that holds a previous state for this aggregate
    And a cache write that fails
    When a delivery is applied and committed durably
    Then the cache key is deleted
    And the next read misses and falls through to the durable store
    And no later delivery is applied on top of the superseded cached state

  Scenario: a cache entry written under an older state shape is passed over while still warm
    Given a fold that has since changed the shape of the state it stores
    And an aggregate whose state was cached moments ago under the older shape
    When the next event for that aggregate arrives
    Then the fold recovers from its own store rather than from the cached entry
    And the cached entry is passed over however recently it was written

  Scenario: a lane that moves to another consumer does not serve the first one's cached state
    Given an aggregate whose state is cached in one consumer's process
    And the lane is subsequently leased by a different consumer
    And that consumer advances the aggregate's state
    When the first consumer leases the lane again
    Then it does not serve its own cached entry
    And it reads the state the other consumer committed

  # ── redelivery and double writes ──

  Scenario: a redelivered delivery is applied again and reaches the same state
    Given an aggregate whose stored state already reflects a delivery
    When that same delivery arrives again
    Then it is applied rather than skipped
    And the state written is the state that was already there

  Scenario: a fold accumulating a counter by addition is rejected by the invariance check
    Given a fold whose state adds a delta on every event
    When the order-invariance check runs over a realistic event set
    Then it reports a duplication counterexample
    And it names re-application rather than ordering as the cause

  Scenario: an event applied late reaches the same state as one applied in order
    Given a fold whose fields are commutative, monotone by rank, or stamped last-write-wins
    When the same event set is applied in every order
    Then every ordering reaches the same state
    And the check reports no ordering counterexample

  Scenario: event ids are compared bytewise, never by locale
    Given two event ids that ICU collation and byte order rank differently
    When the fold tie-breaks a last-write-wins field between them
    Then the bytewise ordering decides
    And two consumers reach the same answer

  # ── batching ──

  Scenario: folding several events reads once and writes once
    Given an aggregate with three queued events
    When the events are folded as one batch
    Then the store is read once and written once
    And the result reflects all three events

  Scenario: a coalesced batch reaches the state the events would have reached one at a time
    Given an aggregate with a backlog of queued events
    When the backlog is folded as one batch
    Then the resulting state equals the state reached by applying each event separately

  Scenario: a batch is bounded by bytes as well as by count
    Given a lane holding more queued bytes than one batch may carry
    When a batch is claimed
    Then it stops at the byte bound before reaching the count bound
    And the remaining events stay queued for the next batch

  Scenario: a batch is bounded by count when the bytes would allow more
    Given a lane holding more queued events than the configured batch size
    When a batch is claimed
    Then it carries exactly the configured maximum
    And the remainder stays queued

  Scenario: a coalesced batch is applied in the lane's ordering, not arrival order
    Given a lane whose queued events were staged out of their ordering-key order
    When the batch is folded
    Then the events are applied in ordering-key order
    And the fold does not reorder anything itself

  Scenario: a keeping-up lane batches one event at a time and behaves as before
    Given a lane whose events are consumed as fast as they are staged
    When each is folded
    Then every batch holds one event
    And the per-event path is unchanged

  Scenario: a failed coalesced batch re-stages the events it drained
    Given a coalesced batch that drained several events from its lane
    And the apply fails
    When the failure is handled
    Then every drained event is back on the lane
    And none of them is lost by having been drained

  Scenario: a fold lane keeps one aggregate's applies serialised
    Given two deliveries for the same aggregate available at once
    When consumers claim work
    Then only one consumer holds that aggregate's lane
    And the two deliveries are applied one after the other, never concurrently

  # ── error handling ──

  Scenario: a failed write is never reported as applied
    Given a store whose write fails
    When a delivery is applied
    Then the failure propagates to the caller
    And no applied outcome is reported

  Scenario: a fold that throws in its own apply is counted, not swallowed
    Given a fold whose own logic raises on an event it was not built for
    When a delivery is applied
    Then that failure is counted alongside store failures

  Scenario: every failure lands on the same measure as a success
    Given a fold whose store cannot be reached
    When a delivery is applied
    Then the failure is counted on the measure that counts successes
    And a projection failing every delivery does not read as one that is merely quiet

  Scenario: an applied delivery is counted with its batch size
    When a delivery is applied
    Then it is counted as applied and the size of its batch is recorded

  # ── tenancy and retention ──

  Scenario: the store sees the tenant and retention the delivery carried
    Given a delivery that names a tenant and a retention period
    When the fold reads and then writes state for that delivery
    Then both the read and the write are made in that tenant and retention
    And that context comes from the delivery itself, not from anything reconstructed later

  Scenario: a fold's read is keyed by the same id its lane is keyed by
    Given a fold mounted on a pipeline that declares its aggregate id per event
    When a delivery is applied
    Then the row the fold reads back is keyed by the declared aggregate id
    And the lane it was serialised on was named from that same declaration

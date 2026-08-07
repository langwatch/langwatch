Feature: GroupQueue batch bisection
  As the LangWatch event-sourcing queue folding coalesced batches per aggregate
  I want a batch that fails to be split in half and retried, rather than
  retried whole
  So that one unprocessable payload cannot take the healthy payloads batched
  alongside it down on every attempt until the group blocks.

  # A coalesced batch is all-or-nothing: the fold stores once at the end, so any
  # throw discards the work for every payload in it, and the retry re-drains the
  # same siblings into the same batch. Nothing narrows, and nothing identifies
  # which payload is at fault. Two failure classes suffer from that:
  #
  #   - one payload cannot be processed at all, and takes up to
  #     coalesceMaxBatch - 1 healthy payloads with it, every attempt;
  #   - the batch is merely too big for a downstream budget, and only succeeds
  #     if a retry happens to reassemble a lighter set.
  #
  # One mechanism covers both, because both are "this set fails but a smaller
  # set might not". Splitting halves until the batch fits, or until the failure
  # is attributable to a single payload.
  #
  # Three constraints bound what it may do:
  #
  #   - ORDERING. A fold derives fields from arrival order, so halves are
  #     contiguous and run in sequence, never concurrently. The order that
  #     matters is the queue's sequence — score first, send position as the
  #     tiebreak — not anything derivable from the payload. A throw also
  #     propagates immediately, so payloads AFTER the offender are not
  #     attempted: stepping over one would apply later payloads across a gap
  #     the fold cannot see. Bisection recovers what precedes the offender and
  #     names it; rescuing what queued behind it needs a separate decision.
  #
  #   - DELIVERY-SCOPED STATE. Each sub-batch commit carries only its own ids,
  #     so a later commit must EXTEND the fold's applied-event-id set rather
  #     than replace it. Sub-batches after the first are therefore marked as
  #     continuations. The flag is set whether the previous call returned or
  #     threw, because a handler that stored and then failed has written just
  #     as surely as one that returned.
  #
  #   - BOUNDED WORK. Splitting runs while the job holds the group's active
  #     key, which the heartbeat keeps renewing, so an unbounded descent would
  #     hold the group lock and a worker slot for the whole tree instead of
  #     yielding. Past a split budget the failure propagates un-split and the
  #     normal retry/backoff path takes over. The budget is read from
  #     LANGWATCH_GQ_BISECTION_SPLIT_BUDGET; zero disables bisection outright,
  #     which restores the previous behaviour without a deploy.

  @integration @coalescing @bisection
  Scenario: Payloads ahead of an unprocessable one still commit
    Given a coalesced batch in which one payload can never be processed
    When the batch is dispatched
    Then every payload sequenced before the offender is committed
    And the offender is narrowed to on its own and named as the cause
    And no payload is committed more than once

  @integration @coalescing @bisection
  Scenario: Each half of a split stays in arrival order
    Given a coalesced batch that fails and is split
    When each half is processed
    Then every sub-batch is a contiguous run of the arrival sequence
    And no sub-batch reorders or interleaves the payloads it carries

  @integration @coalescing @bisection
  Scenario: A split descent emits in the queue's order
    Given a coalesced batch whose payloads were handed over out of order
    When the batch fails and is split down to sub-batches that succeed
    Then the payloads are processed in the order the queue sequenced them
    And a descent that took the second half first would be rejected

  @integration @coalescing @bisection
  Scenario: A batch too large for the handler converges by halving
    Given a handler that rejects any batch above a workable size
    When a batch larger than that size is dispatched
    Then the batch is halved until every part is workable
    And every payload is committed exactly once
    And no two sub-batches are processed concurrently

  @integration @coalescing @bisection
  Scenario: A non-retryable failure is never split
    Given a coalesced batch whose handler fails non-retryably
    When the batch is dispatched
    Then the batch is not split
    And the failure is surfaced immediately

  @integration @coalescing @bisection
  Scenario: Splitting is bounded within one locked attempt
    Given a handler that only ever accepts a single payload
    When a large coalesced batch is dispatched
    Then splitting stops once the budget is spent
    And the remaining failure is handed to the normal retry path
    And the descent does not walk the whole tree under the group lock

  @integration @coalescing @bisection
  Scenario: Setting the split budget to zero disables bisection
    Given the split budget is configured as zero
    When a coalesced batch fails retryably
    Then the batch is not split
    And the handler sees exactly one call carrying the whole batch

  @integration @coalescing @bisection
  Scenario: Sub-batches after the first commit are marked as continuations
    Given a coalesced batch whose first call commits and then fails
    When the batch is split
    Then every later sub-batch is delivered as a continuation
    And their commits extend the applied-event-id set rather than replacing it

  @unit @coalescing @fold
  Scenario: A commit records every id it recognised
    Given a batch carrying one already-applied event alongside new ones
    When the fold commits on a fresh delivery
    Then the already-applied id is still recorded as applied
    And a later delivery carrying that id does not fold it a second time

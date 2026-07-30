@unit
Feature: Fold projections read back their own state
  A fold projection keeps its aggregate's state in a durable store fronted by a
  cache. When the cache is cold it recovers the state from the store — never by
  replaying the aggregate's history from the event log. Replaying the whole
  history on the hot path is what let one large aggregate overwhelm the shared
  store and stall every writer sharing it; a fold recovers from its own last
  committed state instead. (ADR-066, pillar 1.)

  This promise is universal: it holds for every fold, including the ones whose
  stored row keeps only a slimmed, query-shaped summary. Such a fold still
  recovers its full working state from its own row — never from the event log.

  The promise is about state the fold stored in the shape it stores today. When
  a fold changes that shape, everything it committed beforehand records less
  than it now needs, and the parts that were never recorded are indistinguishable
  from parts that were recorded as empty. A fold does not guess: it treats such a
  state as absent and rebuilds that one aggregate from its history, once, after
  which the aggregate is stored in the current shape and recovers from itself
  like every other. The rebuild reaches only aggregates left over from before the
  change, and stops happening at all once they have aged out.

  Background:
    Given a fold projection whose state is persisted after every batch

  Scenario: a cold cache recovers state from the store, not the event log
    Given an aggregate whose state was already committed
    And its cached state has expired
    When the next event for that aggregate arrives
    Then the fold recovers the committed state from its own store
    And it does not replay the aggregate's history from the event log

  Scenario: a brand-new aggregate starts from an empty state
    Given an aggregate that has never been folded
    When its first event arrives
    Then the fold starts from an empty state and applies the event
    And it does not read the event log

  Scenario: an out-of-order event is folded in place, not replayed
    Given a fold that declares how out-of-order events fold into its state
    And an aggregate whose events can arrive out of their business-time order
    When an event arrives older than one already folded
    Then the fold applies it to the current state under its declared ordering contract
    And it does not replay the aggregate's history to reorder

  Scenario: recovered state preserves the fold's internal bookkeeping
    Given an aggregate whose fold tracks de-duplication and running context beyond what its summary row shows
    When the state is recovered from the store after a cold cache
    Then a subsequent contribution does not double-count
    And derived measures that depend on prior context stay correct

  Scenario: a fold whose stored row is a slimmed analytics summary still recovers its working state
    Given a fold whose stored row keeps only the columns an analytics query needs
    And whose working state tracks more than those columns show
    When its cached state has expired and the next event for the aggregate arrives
    Then the fold recovers its full working state from its own stored row
    And a late dimension-only signal still lands on the recovered state
    And it does not replay the aggregate's history from the event log

  Scenario: a stored state written under the fold's current shape is read straight back
    Given an aggregate whose committed state was written by the fold as it stands today
    And its cached state has expired
    When the next event for that aggregate arrives
    Then the fold recovers the committed state from its own store
    And it does not replay the aggregate's history from the event log

  Scenario: a stored state written under an older shape is rebuilt rather than trusted
    Given a fold that has since changed the shape of the state it stores
    And an aggregate whose committed state was written under the older shape
    When the next event for that aggregate arrives
    Then the fold treats the older state as absent rather than reading it back
    And it rebuilds that aggregate's state from the event log
    And the bookkeeping the older shape never recorded is recovered

  Scenario: a state that cannot be read back is never quietly replaced by a partial one
    Given a fold that has since changed the shape of the state it stores
    And an aggregate whose committed state was written under the older shape
    And the fold has no way to rebuild that aggregate from the event log
    When the next event for that aggregate arrives
    Then the fold reports the failure rather than starting from an empty state
    And the committed state is left as it is

  Scenario: rebuilding an aggregate once retires it from rebuilding again
    Given an aggregate whose state was rebuilt because it had been stored under an older shape
    When a further event for that aggregate arrives
    Then the fold recovers the rebuilt state from its own store
    And it does not replay the aggregate's history from the event log

  Scenario: a user-visible name survives a late unrelated contribution
    Given an aggregate whose name was set deliberately by a person
    And whose committed state predates the fold recording that the name was set by a person
    When a late contribution that would otherwise supply a name arrives
    Then the name the person set is preserved

  Scenario: a total recomputed from its recorded parts is not collapsed by the next part
    Given an aggregate whose totals are recomputed whole from every part recorded against it
    And whose committed state predates the fold recording those parts
    When a further part for that aggregate arrives
    Then the totals still account for every part recorded before it

  Scenario: a sequence keeps the order things happened in rather than the order they arrived
    Given an aggregate whose recorded sequence is kept in the order things actually happened
    And whose committed state predates the fold recording when each entry happened
    When a further entry arrives later than an entry that happened after it
    Then the sequence still reflects the order things happened in

  Scenario: a signal with nothing else to store is not lost to a cold cache
    Given an aggregate whose only signal so far is a classification a person or job attached to it
    And the fold has no summary worth committing for it yet
    When its cached state is lost and a later event arrives
    Then that classification is still part of the aggregate's state

  Scenario: a redelivered batch after a committed write does not double-count
    Given a fold that persists its applied-event set durably next to its state
    And an aggregate whose committed state already contains a delivered batch
    And the cache entry recording that batch was lost
    When the same batch is delivered again
    Then the fold recognises every event as already applied
    And the stored state is unchanged

  Scenario: the event log is read only for a deliberate rebuild
    Given a projection whose logic version has changed
    When an operator replays the projection
    Then the fold rebuilds from the event log
    But live delivery never reads the event log to fold

  # For a fold to treat a missing row as proof that nothing was committed, the
  # store must never decline to write a state it was handed. Otherwise absence
  # means either "new" or "declined" and proves neither. So a state with only a
  # dimension, or with no identity of its own, still gets a row; readers that
  # want only aggregates carrying real signal filter on what the row records
  # rather than on whether it exists.
  #
  # This binds the folds whose row is the only durable home of their working
  # state, which is what makes a declined write a lost classification. A fold
  # that still declines one is making the narrower claim that what it declines
  # holds nothing it would ever need back, and it reads its own absence as
  # proof of that and nothing more.

  Scenario: absence is authoritative because nothing is ever gated out
    Given a fold whose row is the only durable home of its working state
    And an aggregate whose only signal so far is a dimension attached to it
    When the fold commits that state
    Then a row is written for it, flagged as carrying no signal of its own
    And a reader asking for aggregates with real signal does not see it
    And a missing row therefore proves the aggregate was never committed

  Scenario: no state is unwritable, identity falls back to the aggregate id
    Given a fold whose row is the only durable home of its working state
    And a committed state that carries no identity of its own
    When the fold commits it
    Then the row is written under the aggregate's id
    And no state is ever dropped for lacking an identity

  Scenario: the redelivery watermark survives the write path
    Given a fold that persists its applied-event set durably next to its state
    When it commits a state after folding a batch
    Then the applied-event set is stored alongside the row, not only in the cache

  Scenario: the watermark round-trips through the read-back
    Given a committed state whose applied-event set was stored with it
    When the fold reads that state back from its store
    Then it recovers the same applied-event set it committed

  Scenario: the watermark survives the eval write path too
    Given an evaluation fold that persists its applied-event set next to its state
    When it commits a state after folding a batch
    Then the applied-event set is stored alongside the row exactly as the trace fold's is

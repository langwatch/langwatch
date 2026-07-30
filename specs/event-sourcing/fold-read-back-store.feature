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

  # Superseded by ADR-101 decision 4: an old-shape row is reported as found
  # and refused, not rebuilt inline. The remedy is an operator-run replay
  # (ADR-101), never a delivery-path read of event_log (ADR-098 decision 3).
  @unimplemented
  Scenario: a stored state written under an older shape is rebuilt rather than trusted
    Given a fold that has since changed the shape of the state it stores
    And an aggregate whose committed state was written under the older shape
    When the next event for that aggregate arrives
    Then the fold treats the older state as absent rather than reading it back
    And it rebuilds that aggregate's state from the event log
    And the bookkeeping the older shape never recorded is recovered

  Scenario: state cached under an older shape is passed over even while it is still warm
    Given a fold whose recent state is served from a cache ahead of its store
    And an aggregate whose state was cached moments ago
    And a fold that has since changed the shape of the state it stores
    When the next event for that aggregate arrives
    Then the fold recovers from its own store rather than from the cached state
    And the cached state is passed over however recently it was written

  Scenario: a state that cannot be read back is never quietly replaced by a partial one
    Given a fold that has since changed the shape of the state it stores
    And an aggregate whose committed state was written under the older shape
    And the fold has no way to rebuild that aggregate from the event log
    When the next event for that aggregate arrives
    Then the fold reports the failure rather than starting from an empty state
    And the committed state is left as it is

  # Superseded by ADR-101 decision 4: an old-shape row is refused rather than
  # rebuilt inline, so there is no delivery-path rebuild left to retire.
  @unimplemented
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

  # Superseded by ADR-098 decision 5: the durably-persisted applied-event set
  # (AppliedEventIds) is abolished and nothing replaces it. Double-counting is
  # ruled out by every fold field being idempotent, not by remembering.
  @unimplemented
  Scenario: a redelivered batch after a committed write does not double-count
    Given a fold that persists its applied-event set durably next to its state
    And an aggregate whose committed state already contains a delivered batch
    And the cache entry recording that batch was lost
    When the same batch is delivered again
    Then the fold recognises every event as already applied
    And the stored state is unchanged

  # Superseded by ADR-098 decision 3 and ADR-101: a "deliberate rebuild"
  # triggered inline by a fold is gone entirely — the only rebuild mechanism
  # left is an offline, operator-run replay (ADR-101), which nothing on the
  # delivery path can invoke.
  @unimplemented
  Scenario: the event log is read only for a deliberate rebuild
    Given a projection whose logic version has changed
    When an operator replays the projection
    Then the fold rebuilds from the event log
    But live delivery never reads the event log to fold

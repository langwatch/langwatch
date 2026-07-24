Feature: Fold projections read back their own state
  A fold projection keeps its aggregate's state in a durable store fronted by a
  cache. When the cache is cold it recovers the state from the store — never by
  replaying the aggregate's history from the event log. Replaying the whole
  history on the hot path is what let one large aggregate overwhelm the shared
  store and stall every writer sharing it; a fold recovers from its own last
  committed state instead. (ADR-066, pillar 1.)

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
    Given an aggregate whose events can arrive out of their business-time order
    When an event arrives older than one already folded
    Then the fold applies it to the current state
    And it does not replay the aggregate's history to reorder

  Scenario: recovered state preserves the fold's internal bookkeeping
    Given an aggregate whose fold tracks de-duplication and running context beyond what its summary row shows
    When the state is recovered from the store after a cold cache
    Then a subsequent contribution does not double-count
    And derived measures that depend on prior context stay correct

  Scenario: the event log is read only for a deliberate rebuild
    Given a projection whose logic version has changed
    When an operator replays the projection
    Then the fold rebuilds from the event log
    But live delivery never reads the event log to fold

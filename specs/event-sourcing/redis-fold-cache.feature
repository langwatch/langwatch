Feature: Redis write-through cache for fold state

  Fold projections build state by reading what came before, applying an
  event, and writing the result back. Reading that state from the durable
  store on every batch is expensive — for a large trace it is hundreds of
  kilobytes — so a Redis cache sits in front of it.

  The cache is an optimisation, not a durability mechanism. A miss falls
  through to the durable store and the fold continues.

  It carries one extra thing: the ids of the events already folded into the
  cached state. Queue delivery is at-least-once, and a job that fails after
  its state was stored is re-dispatched with the same events. Most fold
  handlers accumulate — span counts, token and cost sums, id appends — so
  re-applying would double-count. That set is scoped to a retry chain: a
  fresh delivery replaces it, because the previous batch for that group must
  have been acked and its ids can never come back; a retry merges into it,
  because they still can.

  Because the set lives in the cache entry, losing the entry loses the
  protection. That leaves the cold path open, and closing it means making
  the folds themselves idempotent — see dev/docs/plans/fold-idempotency-plan.md.

  Background:
    Given a fold projection with a cached store
    And a durable store behind it

  Scenario: A cached entry is served without reading the durable store
    Given the fold state for aggregate "trace-1" is cached
    When the fold reads state for "trace-1"
    Then the cached state is returned
    And the durable store is not read

  Scenario: A miss reads the durable store
    Given the fold state for aggregate "trace-1" is not cached
    And the durable store holds state for "trace-1"
    When the fold reads state for "trace-1"
    Then the state is returned from the durable store

  Scenario: A redelivered event is not applied twice
    Given a fold job for aggregate "trace-1" failed after its state was stored
    When the job is retried with the same events
    Then those events are recognised as already applied
    And the aggregate reflects each event exactly once

  Scenario: A retry chain remembers everything it has applied
    Given a fold job failed after storing, and new events arrived before it retried
    When the retry applies the new events and fails again
    And the whole set is delivered once more
    Then no event is applied twice across the chain

  Scenario: A fresh delivery forgets what an acked batch applied
    Given consecutive batches for one aggregate that all succeed
    When each batch is stored
    Then the recorded event ids are only those of the most recent batch
    And the record does not grow with the number of batches

  Scenario: A sibling leading a retry is still recognised as a retry
    Given a coalesced batch failed and its drained siblings were re-staged
    When a sibling is dispatched first on the next attempt
    Then it is treated as a continuation of the retry chain
    And the events the chain already applied are not applied again

  Scenario: A corrupt cached entry is treated as a miss
    Given the cached entry for aggregate "trace-1" cannot be read back
    When the fold reads state for "trace-1"
    Then the durable store is read instead
    And the fold is not failed, because the state is durable
    And the read is counted, because the record of applied events went with it

  Scenario: Losing the cached entry loses the protection
    Given a fold job failed after its state was stored
    And its cached entry is evicted before the retry
    When the job is retried with the same events
    Then the events are applied again
    And the aggregate over-counts, as it did before the record existed

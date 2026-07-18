Feature: Redis write-through cache for fold projections

  Fold projections accumulate state by reading the previous state,
  applying an event, and writing back. With replicated ClickHouse
  behind an NLB, reads can hit a stale replica, causing data loss.
  A Redis cache layer eliminates replication lag and enables
  fire-and-forget ClickHouse writes for better batching.

  Background:
    Given a fold projection with a Redis-cached store
    And ClickHouse as the inner persistent store

  Scenario: Cache hit returns state from Redis without querying ClickHouse
    Given the fold state for aggregate "trace-1" is cached in Redis
    When the fold reads state for "trace-1"
    Then the state is returned from Redis
    And ClickHouse is not queried

  Scenario: Cache miss falls back to ClickHouse
    Given the fold state for aggregate "trace-1" is not in Redis
    And ClickHouse has state for "trace-1"
    When the fold reads state for "trace-1"
    Then the state is returned from ClickHouse

  Scenario: A durable write that cannot be cached still leaves the fold correct
    Given new fold state for aggregate "trace-1" was durably stored
    And the cache still holds the state from before that event
    When caching the new state fails but the stale entry can be discarded
    Then the next fold step reads the durable state instead
    And the event is reflected in the aggregate exactly once

  Scenario: A stale cache entry that cannot be discarded fails the fold
    Given new fold state for aggregate "trace-1" was durably stored
    And the cache still holds the state from before that event
    When caching the new state fails and the stale entry cannot be discarded
    Then the fold attempt fails so its queue can retry it
    And the retried fold applies the event to the pre-event state
    And the event is reflected in the aggregate exactly once

  Scenario: A trace whose events keep folding is never double-counted
    Given a trace whose fold accumulates a running span count
    When a cache write fails part-way through the trace
    Then the final span count matches the number of spans ingested

  Scenario: ClickHouse write failure triggers replay from event log
    Given the fold stores new state for aggregate "trace-1"
    And the ClickHouse INSERT fails with a connection error
    When the failure is detected
    Then a replay job is queued for aggregate "trace-1"

  Scenario: Replay rebuilds state from event log
    Given the event log contains 6 span events for trace "trace-1"
    When the replay job runs for "trace-1"
    Then all 6 events are read from the event log
    And the fold is rebuilt from init state
    And the final state is written to ClickHouse with durability wait
    And the final state is cached in Redis

  Scenario: An expired cache entry causes graceful fallback to the durable store
    Given the fold state for aggregate "trace-1" was cached long enough ago to expire
    When the fold reads state for "trace-1"
    Then the state is returned from the durable store

  Scenario: Sequential fold steps use Redis for consistency
    Given a trace with 6 spans arriving within 2 seconds
    When all 6 spans are processed through the fold
    Then each fold step after the first reads from Redis
    And the final state contains all 6 spans accumulated data
    And ClickHouse receives the writes asynchronously

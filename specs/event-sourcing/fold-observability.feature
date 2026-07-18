Feature: Fold projection observability

  Operators need durable metrics for store-miss re-folds and cache failures so
  they can distinguish expected first-touch work from replays caused by gaps.

  Scenario: First-touch store miss is visible
    Given a fold projection store has no state for an aggregate
    And the event history contains only the delivered events
    When the projection rebuilds the aggregate from the event history
    Then the rebuild is counted as a first-touch store-miss re-fold
    And the number of replayed history events is recorded

  Scenario: Resumed store miss is visible
    Given a fold projection store has no state for an aggregate
    And the event history contains events beyond the delivered batch
    When the projection rebuilds the aggregate from the event history
    Then the rebuild is counted as a resumed store-miss re-fold
    And the number of replayed history events is recorded

  Scenario: Streamed store-miss re-folds have the same visibility
    Given an order-insensitive fold streams its event history in pages
    When the projection rebuilds after a store miss
    Then the rebuild kind is derived from the full streamed history
    And the total number of replayed history events is recorded

  Scenario: Redis cleanup failure is visible
    Given writing new fold state to Redis fails
    When deleting the stale Redis cache entry also fails
    Then the Redis delete failure is counted separately
    And the original write failure is still propagated for retry

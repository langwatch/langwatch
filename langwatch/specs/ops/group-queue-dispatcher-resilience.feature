Feature: GroupQueue dispatcher connection resilience
  As CI infrastructure running integration tests across 6 shards
  I want the GroupQueueProcessor's blocking connection to retry after transient Redis errors
  So that flaky BRPOP failures do not stall the dispatcher and cause test timeouts

  # Issue: https://github.com/langwatch/langwatch/issues/4824
  # Root cause: blockingConnection inherited maxRetriesPerRequest=0 from the test
  # Redis connection via duplicate(), causing BRPOP to throw immediately on transient
  # connection drops instead of retrying. The dispatcher's 1-second error-sleep stacked
  # up to exceed the 10-second vi.waitFor timeout in the squash test.

  @integration
  Scenario: GroupQueueProcessor retries blocked operations regardless of source connection retry settings
    Given a Redis connection configured to fail immediately on transient errors
    When a GroupQueueProcessor is created with this connection as the consumer connection
    Then the dispatcher retries BRPOP operations automatically after transient connection failures

  @integration
  Scenario: Delayed squashed job processes exactly once within timeout
    Given a GroupQueueProcessor with delay 200ms and deduplication enabled
    When two jobs with the same dedup key are sent in rapid succession
    Then the processor callback receives the second job's payload exactly once
    And this completes within 10 seconds

  @unit
  Scenario: ClickHouse migration guard prevents duplicate migrations per URL
    Given startTestContainers has been called once for a given ClickHouse URL
    When startTestContainers is called again with the same ClickHouse URL
    Then initializeClickHouseSchema is not called a second time for that URL

  @unit
  Scenario: Cluster connections also get a dedicated blocking connection
    Given a Redis Cluster connection as the consumer connection
    When a GroupQueueProcessor is created in consumer mode
    Then the blocking connection is a dedicated duplicate, not the shared cluster connection

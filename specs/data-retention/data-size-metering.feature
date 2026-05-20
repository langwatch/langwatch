Feature: Data size metering for storage billing
  As a billing system
  I track how much data each tenant stores
  So that we can bill 3 EUR per GB of stored data

  Background:
    Given the organization has a SEAT_EVENT plan
    And the project has 30-day retention for traces

  Scenario: Size estimated at ingestion time
    When a span with 5KB of payload is ingested
    Then the stored_spans record has _size_bytes approximately 5120
    And the estimate includes attribute maps, events, and links

  Scenario: Per-tenant storage query sums across all tables
    Given the project has data in stored_spans, trace_summaries, and event_log
    When the storage size is queried for this tenant
    Then the result is the sum of _size_bytes across all 11 retention-managed tables

  Scenario: Storage decreases as TTL deletes rows
    Given the tenant has 10GB of stored data
    And 3GB of data expires through retention TTL
    When the storage size is recalculated
    Then the result is approximately 7GB

  Scenario: Storage size is cached in Redis
    When the storage size is queried for a tenant
    Then the result is cached with a 5-minute TTL
    And subsequent queries within 5 minutes return the cached value

  Scenario: Ingestion increments cached storage size
    Given the tenant has a cached storage size of 5GB
    When a batch of 100MB of spans is ingested
    Then the cached storage size is incremented to approximately 5.1GB via atomic INCRBY

  Scenario: Stripe meter reports stored GB
    When the billing cycle reports usage
    Then the Stripe meter langwatch_stored_data_gb receives the current stored GB
    And the customer is billed at 3 EUR per GB above their plan's included amount

  Scenario: Storage display in settings UI
    When the user opens project settings
    Then they see current stored data formatted as "X.XX MB / Y.YY GB"
    And a per-category breakdown showing traces, scenarios, and experiments separately

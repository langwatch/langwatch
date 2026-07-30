Feature: Data size metering for storage billing
  As a billing system
  I track how much data each tenant stores
  So that we can bill 3 EUR per GB of stored data

  Background:
    Given the organization has a SEAT_EVENT plan
    And the project has 30-day retention for traces

  @unimplemented
  Scenario: Size estimated at ingestion time
    When a span with 5KB of payload is ingested
    Then the stored_spans record has _size_bytes approximately 5120
    And the estimate includes attribute maps, events, and links

  @unit
  Scenario: Per-tenant storage query sums across all tables
    Given the project has data in stored_spans, trace_summaries, and event_log
    When the storage size is queried for this tenant
    Then the result is the sum of _size_bytes across every retention-managed table
    And each table's bytes land in the retention category that governs it

  @unimplemented
  Scenario: Storage decreases as TTL deletes rows
    Given the tenant has 10GB of stored data
    And 3GB of data expires through retention TTL
    When the storage size is recalculated
    Then the result is approximately 7GB

  # The cache is stale-while-revalidate: a read inside the freshness window is
  # served from Redis without touching ClickHouse, and a read past it serves the
  # last good value while a single background recompute refreshes it. There is
  # no incremental write path — ingestion never adjusts the cached figure, it
  # simply goes stale — so the figure a customer sees can lag ingestion by the
  # freshness window and never drifts from a missed increment.
  @unit
  Scenario: Storage size is cached in Redis
    When the storage size is queried for a tenant
    Then the result is cached with a 5-minute freshness window
    And subsequent queries within that window return the cached value without recomputing

  @unimplemented
  Scenario: Stripe meter reports stored GB
    When the billing cycle reports usage
    Then the Stripe meter langwatch_stored_data_gb receives the current stored GB
    And the customer is billed at 3 EUR per GB above their plan's included amount

  @unimplemented
  Scenario: Storage display in settings UI
    When the user opens the Retention Policies settings page
    Then the "Data Storage" section of the Retention + Usage card shows the project's total stored bytes formatted with a binary unit (e.g. "1.96 GB")

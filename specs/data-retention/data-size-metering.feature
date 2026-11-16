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

  # ADR-202 Decided 20 and 22: each owning module answers for its own tables through its *Api,
  # eventing answers for event_log, and stored_log_records no longer counts.
  @unit
  Scenario: The storage figure is the sum each owning module reports for its own tables
    Given trace, log, evaluation, experiment, scenario, suite and langy each hold data for the project
    And the event log holds data for the project
    When the storage size is queried for this tenant
    Then each owning module is asked for the project's stored bytes
    And the result is the sum of their answers and the event log's bytes

  @unit
  Scenario: An owner that cannot answer is left out of the total and logged
    Given one owning module cannot report its stored bytes
    When the storage size is queried for this tenant
    Then the result is the sum of the owners that answered
    And the owner that failed is logged by name

  @unit
  Scenario: When no owner answers, the figure degrades to 0 and refreshes on the next read
    Given no owning module and not the event log can report stored bytes
    When the storage size is first queried for this tenant
    Then the result is 0, cached as already stale
    And the next read refreshes it in the background once the owners answer again

  Scenario: Storage decreases as TTL deletes rows
    Given the tenant has 10GB of stored data
    And 3GB of data expires through retention TTL
    When the storage size is recalculated
    Then the result is approximately 7GB

  @unit
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
    When the user opens the Retention Policies settings page
    Then the "Data Storage" section of the Retention + Usage card shows the project's total stored bytes formatted with a binary unit (e.g. "1.96 GB")

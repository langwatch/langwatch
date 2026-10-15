Feature: Data size display for retention settings
  As a project admin
  I see how much data my project stores
  So that I can understand my retention footprint

  # Billing measurement moved to specs/billing/storage/ (event-sourced gauge).
  # This file covers only the settings-UI display path, which keeps using the
  # cached per-tenant total. Ingestion-time _size_bytes stamping is specified
  # in ingestion-stamping.feature.

  Scenario: Per-tenant storage query sums across retention-managed tables
    Given the project has data in stored_spans, trace_summaries, and event_log
    When the storage size is queried for this tenant
    Then the result is the sum of _size_bytes across the retention-managed tables

  Scenario: Storage size is cached in Redis
    When the storage size is queried for a tenant
    Then the result is cached with a 5-minute TTL
    And subsequent queries within 5 minutes return the cached value

  Scenario: Ingestion increments cached storage size
    Given the tenant has a cached storage size of 5GB
    When a batch of 100MB of spans is ingested
    Then the cached storage size is incremented to approximately 5.1GB via atomic INCRBY

  Scenario: Storage display in settings UI
    When the user opens the Retention Policies settings page
    Then the "Data Storage" section of the Retention + Usage card shows the project's total stored bytes formatted with a binary unit (e.g. "1.96 GB")

@traces @api
Feature: Trace search response carries token metrics and optional enriched spans
  As a data consumer pulling traces over the public API for BI or agent analytics
  I want per-trace token breakdowns and optional full spans from the search endpoint
  So that context and cache economics are analyzable without private endpoints

  # Compatibility contract: this surface is consumed by customer BI pipelines
  # and changes are additive only. No existing key is renamed, removed, or
  # given a new meaning; every scenario below adds fields next to the ones
  # that already flow.

  @unit
  Scenario: metrics carries the token fields the projection catalog already advertises
    Given a trace summary whose attributes carry reserved cache read, cache creation and reasoning token counts
    When the summary is mapped to the legacy trace shape
    Then metrics.cache_read_input_tokens equals the reserved cache read count
    And metrics.cache_creation_input_tokens equals the reserved cache creation count
    And metrics.reasoning_tokens equals the reserved reasoning count

  @unit
  Scenario: metrics carries context size and the cache creation TTL split
    Given a trace summary whose attributes carry reserved context size, 5 minute and 1 hour cache creation counts
    When the summary is mapped to the legacy trace shape
    Then metrics.context_size_tokens equals the reserved context size
    And metrics.cache_creation_5m_input_tokens equals the reserved 5 minute count
    And metrics.cache_creation_1h_input_tokens equals the reserved 1 hour count

  @unit
  Scenario: absent reserved token attributes leave the metrics fields unset
    Given a trace summary whose attributes carry no reserved token counts
    When the summary is mapped to the legacy trace shape
    Then the mapped metrics carry only the six legacy fields with no token additions

  @unit
  Scenario: existing metadata keys flow untouched and otel_log_record_count is added as a sibling
    Given a trace summary whose attributes carry langwatch.reserved.log_record_count
    When the summary is mapped to the legacy trace shape
    Then metadata carries the key "langwatch.reserved.log_record_count" with its original string value
    And metadata carries otel_log_record_count with the same value

  @unit
  Scenario: a caller-defined otel_log_record_count metadata key is never overwritten
    Given a trace summary whose attributes carry both metadata.otel_log_record_count set by the caller and langwatch.reserved.log_record_count
    When the summary is mapped to the legacy trace shape
    Then metadata.otel_log_record_count carries the caller's value

  @integration
  Scenario: search with includeSpans returns coding-agent spans enriched from log records
    Given a stored coding-agent trace whose llm_request span carries tokens but no content and no cost
    And the trace's stored log records carry the request body and the cost for that span
    When the search endpoint is called with includeSpans true
    Then the returned trace's spans carry content and cost joined from the log records

  @integration
  Scenario: search without includeSpans keeps the legacy empty spans shape
    Given a stored coding-agent trace
    When the search endpoint is called without includeSpans
    Then every returned trace carries spans as an empty array

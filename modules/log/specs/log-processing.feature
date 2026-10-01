# See ../adrs/001-log-processing-boundary.md

Feature: Canonical OTLP log processing
  As an OpenTelemetry log producer
  I want logs canonicalised and durably recorded
  So that valid records survive retries and can contribute to traces

  @unit
  Scenario: Valid OTLP logs become canonical durable events
    Given an OTLP log request containing valid records
    When process composition prepares and records the logs
    Then each accepted record has a deterministic 64-hex record ID
    And the pipeline emits `lw.obs.log.record_received` events for the `log` aggregate
    And canonicalLogStorage projects the records to `log_records` and `log_usage_estimates`

  @unit
  Scenario: Invalid log siblings use partial success
    Given an OTLP log request containing one valid record, one malformed record, and one record over the 1 MiB canonical payload limit
    When the Log service prepares the request
    Then the valid record is accepted
    And the two invalid records are counted as permanent rejections
    And the response preserves the existing partial-success error mapping

  @unit
  Scenario: Canonical log identity and retries are stable
    Given the same tenant submits the same canonical log record twice
    When durable log processing is retried after a persistence failure
    Then the record ID, event version, aggregate identity, and tenant-scoped idempotency key are unchanged
    And the retry can persist the record without creating a second logical record

  @unit
  Scenario: A correlated log contributes to Trace without sharing ownership
    Given a durable canonical log has a valid wire or synthesized trace correlation
    When process composition dispatches its trace contribution
    Then Trace receives only the compact contribution contract
    And Trace owns the trace fold rather than Log owning trace persistence

  @unit
  Scenario: Trace contribution is best effort
    Given a canonical log is accepted and its Trace contribution cannot be delivered
    When the contribution attempt fails
    Then the canonical log event and storage remain durable
    And Log reports no durable-write failure for the accepted record

  @unit
  Scenario: An uncorrelated log does not call Trace
    Given a canonical log has no valid correlation IDs
    When the Log pipeline processes it
    Then the record is stored normally
    And no Trace contribution is requested

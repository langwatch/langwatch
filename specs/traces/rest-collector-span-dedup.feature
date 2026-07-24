Feature: REST collector deduplicates repeated spans
  As an operator running the LangWatch trace ingestion pipeline
  I want the REST `/api/collector` endpoint to skip spans that were already
  ingested for the same `(tenant, trace, span)` tuple
  So that an SDK retry loop cannot fan out into the event-sourcing group
  queue and exhaust Redis memory

  # =========================================================================
  # Why this exists
  # =========================================================================
  #
  # The OTLP ingestion path (`TraceRequestCollectionService.handleOtlpTraceRequest`)
  # short-circuits duplicate spans via `SpanDedupService.tryAcquireProcessingLock`
  # — a Redis SET-NX with TTL keyed on `(tenantId, traceId, spanId)`. When the
  # same span arrives twice, the second attempt resolves as `deduped` and never
  # dispatches the `recordSpan` command.
  #
  # The legacy REST `/api/collector` endpoint did not call the same dedup gate.
  # It dispatched `recordSpan` for every span on every request, relying only on
  # a coarse per-trace MD5 check that misses any payload that changes a single
  # byte (e.g. timestamps, attached evaluations, partial updates).
  #
  # A retry loop on a single trace can therefore enqueue the same span tens of
  # thousands of times into the same event-sourcing group hash
  # (`{event-sourcing/jobs}:gq:group:<tenant>/command/recordSpan/trace:<id>:data`).
  # Each event lands under a fresh event UUID, so the GQ never collapses them.
  #
  # =========================================================================
  # Behavior
  # =========================================================================
  #
  # Both ingestion paths must go through the same dedup gate. A repeated span
  # — same tenant, same trace_id, same span_id — must dispatch `recordSpan`
  # exactly once until the dedup TTL expires.

  Background:
    Given the REST `/api/collector` endpoint accepts span payloads from a project's API key
    And a span is identified by the tuple `(tenantId, traceId, spanId)`
    And the dedup TTL window has not expired

  Scenario: A repeated span is skipped on the REST path
    When the same span is posted twice in the same dedup window
    Then the trace processing pipeline receives the span exactly once
    And the duplicate is counted toward the response's `dedupedSpans` summary

  Scenario: Distinct spans on the same trace are not deduped
    Given a trace containing two distinct spans
    When both spans are posted in the same request
    Then the pipeline receives both spans
    And no span is reported as deduped

  Scenario: Two ingestion paths share the same dedup gate
    Given a span has already been ingested via the OTLP collector
    When the same span is posted via the REST collector within the dedup window
    Then the REST request does not dispatch the span to the pipeline

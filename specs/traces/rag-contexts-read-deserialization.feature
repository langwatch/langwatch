Feature: RAG contexts survive the ClickHouse read path
  As an SDK user attaching RAG contexts to a span
  I want the trace read APIs to return those contexts
  So that RAG debugging and faithfulness evaluation work from stored traces

  # =========================================================================
  # Why this exists
  # =========================================================================
  #
  # The Python/TS SDKs attach retrieval results to a span as the
  # `langwatch.rag_contexts` attribute: a JSON-encoded array of
  # `{document_id, chunk_id, content}` chunks. Ingestion canonicalises it to
  # `langwatch.rag.contexts` (parsed array), and ClickHouse stores it in
  # `stored_spans.SpanAttributes`, a Map(String, String) column — so on disk
  # the value is a JSON string again.
  #
  # Reading spans back happens at three sites:
  #
  #   1. `app-layer/traces/repositories/span-storage.clickhouse.repository.ts`
  #      → runs `deserializeAttributes` (JSON strings parsed back). Correct.
  #   2. `server/traces/clickhouse-trace.service.ts` (`mapSpanRow`)
  #      → cast the raw Map values straight into NormalizedSpan. Broken.
  #   3. `server/traces/repositories/span-storage.clickhouse.repository.ts`
  #      → same raw cast. Broken.
  #
  # Sites 2 and 3 feed `mapNormalizedSpansToSpans`, whose `extractContexts`
  # required an actual array (`Array.isArray`) and returned nothing for the
  # stored JSON string — so the public REST trace API returned
  # `contexts: []` for every RAG span, while the same span rendered fine on
  # read paths that go through site 1. Sibling extractors (`extractInput`,
  # `extractOutput`, `getAnnotatedType`) already JSON-parse string values
  # defensively; `extractContexts` was the odd one out.
  #
  # =========================================================================

  Background:
    Given a project with traces stored in ClickHouse `stored_spans`
    And a span of type "rag" whose `langwatch.rag.contexts` attribute was
      serialized to a JSON string by the Map(String, String) write boundary

  Scenario: Span mapper recovers contexts from a stored JSON string
    When `mapNormalizedSpansToSpans` maps span attributes containing
      `langwatch.rag.contexts` as the string "[{\"document_id\":\"doc-1\",\"content\":\"chunk text\"}]"
    Then the mapped span has contexts with document_id "doc-1" and content "chunk text"

  Scenario: Span mapper still accepts contexts as a real array
    When `mapNormalizedSpansToSpans` maps span attributes containing
      `langwatch.rag.contexts` as a parsed array of chunk objects
    Then the mapped span has the same contexts as before this fix

  Scenario: Malformed contexts strings degrade to no contexts, not an error
    When `mapNormalizedSpansToSpans` maps span attributes containing
      `langwatch.rag.contexts` as the string "[not json"
    Then the mapped span has empty contexts
    And mapping does not throw

  Scenario: REST trace API returns contexts for a RAG span
    Given a RAG span ingested through the OTLP collector with two contexts
    When the client calls GET /api/trace/{traceId}
    Then the RAG span in the response carries both contexts
    And string-typed JSON attributes (timestamps, params) are returned as
      structured values, not JSON-encoded strings

  Scenario: Trace-scoped span listing returns contexts
    Given the same RAG span
    When spans are read through `SpanStorageService.getSpansByTraceId`
    Then the RAG span carries both contexts

  # ==========================================================================
  # Found while writing the integration test for the scenario above:
  # the repository's dedup tuple `(TenantId, TraceId, SpanId, StartTime)`
  # resolved `StartTime` to the SELECT alias
  # `toUnixTimestamp64Milli(StartTime) AS StartTime` (ClickHouse lets SELECT
  # aliases shadow columns in WHERE), comparing milliseconds against
  # `max(StartTime)` as DateTime64(9) — never equal, so the repository
  # returned ZERO spans for every trace. The trace-details service avoids
  # this by table-qualifying the tuple (`t.StartTime`); the repository now
  # does the same.
  # ==========================================================================
  Scenario: Span listing dedup tuple compares the raw StartTime column
    Given a single stored span version for a trace
    When spans are read through `SpanStorageService.getSpansByTraceId`
    Then the span is returned (the dedup tuple must not match against the
      millisecond SELECT alias)

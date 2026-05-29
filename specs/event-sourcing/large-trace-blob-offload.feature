Feature: Large trace payloads — event_log as single source of truth · transient S3 spool · lean projections
  As the LangWatch ingestion pipeline handling large LLM trace payloads
  I want over-threshold span content carried in the durable event_log row
  and a single leanForProjection utility shared by live dispatch and replay
  So that Redis and the worker event loop stay healthy, full IO reaches
  online evaluators, search hits a preview wide enough for a standard
  Claude response, and replay produces byte-identical projection state.

  # Issue #4215 — https://github.com/langwatch/langwatch/issues/4215
  # Design: ADR-022 (supersedes ADR-021's edge-permanent-S3 mechanism).
  #
  # Implementation surfaced two facts ADR-021 didn't account for:
  #   1. capOversizedAttributes(256 KB) already exists at recordSpanCommand.ts:146.
  #      Everything downstream of the command worker is already bounded today.
  #      The unbounded-payload problem is narrower than ADR-021 framed: it is
  #      the edge → command-queue leg, where the full OTLP request rides
  #      through Redis BEFORE the cap fires.
  #   2. Commands go through a queue. commands.traces.recordSpan(data).send()
  #      stages the full command payload in Redis. The event isn't in
  #      event_log when .send() returns. To lean the Redis pressure point we
  #      must lean BEFORE .send() — via edge size-check + transient S3 spool.
  #
  # Decision:
  #   - event_log carries FULL content (ZSTD-compressed). Single source of truth.
  #   - S3 is reduced to a transient spool, only for commands > 256 KB.
  #     Eagerly DELETEd after event_log INSERT succeeds; 24h lifecycle safety
  #     net catches orphans.
  #   - leanForProjection(event) runs at TWO call sites:
  #       (a) eventSourcingService.ts:242-251 (live, between storeEvents and
  #           router.dispatch)
  #       (b) replayExecutor.apply (replay, before invoking projection.apply)
  #     Same utility → projection state is path-independent.
  #   - IO_PREVIEW_BYTES = 64 KB (covers a standard Claude response, ~16K tokens).
  #     Configurable via LANGWATCH_IO_PREVIEW_BYTES. Non-IO attributes stay at
  #     DEFAULT_PREVIEW_BYTES = 2 KB.
  #   - "Show full" / online eval JOINs event_log directly. List/search use
  #     projection preview columns; no event_log JOIN on the hot path.
  #
  # Related ADRs: 007 (event sourcing), 015 (replay), 017 (gateway payload
  # capture / 32 KB cap), 021 (superseded on the offload mechanism — its
  # reserved-namespace + differential-preview + facet-filter rules survive).

  Background:
    Given the feature flag "release_trace_blob_offload" is enabled
    And the trace-processing pipeline is folding span events through the
        Redis-cached fold store with ClickHouse as the durable store
    And IO_PREVIEW_BYTES is configured at 64 KB
    And COMMAND_INLINE_THRESHOLD is configured at 256 KB

  # ===========================================================================
  # Track 1 — fold cache leanness (Redis / event-loop relief)
  # ===========================================================================

  @e2e @track1
  # Bound by redisCachedFoldStore.unit.test.ts — the @scenario annotation on
  # "given a toCacheable projection and a fold state carrying a 1 MB output"
  # asserts cached entry length < 1 MB and computedOutput is null in cache,
  # while the inner ClickHouse store still receives the full state.
  # Two complementary mechanisms enforce the bound:
  #   1. The dispatch interposition replaces over-threshold IO attribute values
  #      with a 64 KB preview before the projection queue, so the fold cache is
  #      naturally bounded at the input boundary.
  #   2. RedisCachedFoldStore.toCacheable on traceSummary.foldProjection strips
  #      computedOutput from the cached shape (CH still gets the full state).
  Scenario: Folding a trace with a 1 MB output keeps the Redis cache entry lean
    Given a trace whose span carries a 1 MB output value
    When all spans of the trace are folded into the trace summary
    Then the Redis fold cache entry "fold:...:{traceId}" carries at most a 64 KB preview per IO attr
    And the cached JSON contains no events[] payload
    And the cached JSON still carries the reductions and winner-span pointers
        needed by the next fold step

  @e2e @track1 @unimplemented
  # Bound by the rewritten integration test + blob-store.event-log.unit.test.ts
  # in Step 4. Will lose @unimplemented when those land.
  Scenario: Trace-detail full read returns input and output byte-identical to ingestion
    Given a trace with a large input and a large output was fully ingested
    When getTracesWithSpans is called for that trace with full=true
    Then the returned input is byte-identical to the ingested input
        (resolved server-side via the event_log JOIN read path)
    And the returned output is byte-identical to the ingested output

  @integration @track1 @unimplemented
  # Covered by existing fold-projection tests; the fold's apply and
  # accumulateIO are unmodified by this PR. The lean step happens at the
  # dispatch interposition AFTER the event is durable in event_log, so the
  # fold sees the same inputs (preview-shaped) regardless of order.
  Scenario: Out-of-order refold converges on the same state as in-order folding
    Given the span events of a trace arrive out of their occurrence order
    When the trace is folded
    Then the resulting trace summary matches the state produced by folding the
        same events in occurrence order
    And the winning input, output, and root span pointers are unchanged

  @integration @track1 @unimplemented
  # Existing EvaluationTrigger reactor tests cover the trigger semantics.
  # Reactors receive { event, foldState } from the projection queue, where
  # event is the lean shape produced by leanForProjection. Bind once an
  # integration test exercises trigger firing on a leaned event.
  Scenario: EvaluationTrigger reactor fires correctly off the lean event
    Given a trace folds to a state that satisfies an evaluation trigger
    When the leaned event is dispatched to the reactor queue
    Then the EvaluationTrigger reactor observes the trigger condition
    And the evaluation is scheduled exactly as it is without the lean step

  # ===========================================================================
  # Track 2 — event_log as SoT · transient spool · SDK / gateway defaults · read resolution
  # ===========================================================================

  @e2e @track2 @unimplemented
  # Python SDK default raised to 32 KB (constructor + public factory:
  # python-sdk/src/langwatch/telemetry/tracing.py:96, 786). TS SDK has no
  # transport-layer cap (grep confirms only CLI display helpers). Go gateway
  # has no sdktrace.WithSpanLimits and no manual truncation in
  # customertracebridge/emitter.go (OTel Go SDK v1.43.0 defaults to unlimited).
  # Bind once an end-to-end SDK→server test exercises the 50 KB path.
  Scenario Outline: SDK transmits a 50 KB output in full without client-side truncation
    Given a <sdk> instrumented span produces a 50 KB output
    When the span is exported to LangWatch
    Then the received output is the full 50 KB
    And the received output contains no "(truncated string)" marker

    Examples:
      | sdk            |
      | Python SDK     |
      | TypeScript SDK |

  @integration @track2 @unimplemented
  # Go AI Gateway (services/aigateway/) has no sdktrace.WithSpanLimits and no
  # manual truncation in customertracebridge/emitter.go. OTel Go SDK v1.43.0
  # defaults to unlimited attribute value length. No code change required.
  # Bind once a Go-side test pins the absence of a cap.
  Scenario: Gateway forwards a payload larger than 32 KB without flagging truncation
    Given the AI gateway receives a request whose captured payload exceeds 32 KB
    When the gateway records the payload for the trace
    Then the full payload is captured
    And the span is not annotated with "langwatch.input_truncated"

  @integration @track2
  # Bound by recordSpanCommand.oversized.unit.test.ts + edge-offload.unit.test.ts
  # written in Step 4 of the TDD plan. Will lose @unimplemented when those land.
  Scenario: An over-threshold command is spooled to S3 transiently and reconstituted
    Given a span whose serialized command payload exceeds 256 KB
    When the trace is collected at the ingestion edge
    Then the full span content is written to S3 as a transient spool object
    And the RecordSpan command queued in Redis carries only a {spoolRef}
    When the command worker picks up the oversized command
    Then it fetches the full content from the S3 spool
    And it constructs a SpanReceivedEvent containing the full content
    And the event is written to event_log with the full content as EventPayload
    And after event_log INSERT succeeds the S3 spool object is best-effort DELETEd

  @integration @track2 @unimplemented
  # Bound by edge-offload.unit.test.ts written in Step 4.
  Scenario: When edge S3 spool PUT fails, ingestion falls back to inline (fail-open)
    Given a span whose serialized command payload exceeds 256 KB
    And the S3 spool PUT fails at the edge
    When the edge decides how to send the command
    Then it sends a regular RecordSpan command with the full inline payload
    And it logs a warning "oversize protection skipped; queue carries full payload"
    And ingestion is not blocked

  @integration @track2
  # Bound by the rewritten integration test + interposition.unit.test.ts in Step 4.
  Scenario: event_log carries the full event content; projection queue carries the lean shape
    Given a span field value exceeds the offload threshold
    When the trace is ingested via the live pipeline
    Then the event_log row's EventPayload contains the full field value byte-identical to ingestion
    And the projection-queue event carries a preview of at most 64 KB for that IO attr
    And the projection-queue event carries a reserved attribute "langwatch.reserved.eventref.{attrKey}"
    And the queue-side payload contains no full field content

  @e2e @track2
  # Bound by blob-store.event-log.unit.test.ts (resolution mechanism) + the
  # rewritten integration test (end-to-end eval path) in Step 4.
  Scenario: An online evaluator on an over-threshold trace receives the full output
    Given an online evaluator is configured for a trace whose output exceeds the threshold
    When the evaluation executes
    Then the evaluator's captured input contains the full output
        (resolved via the event_log JOIN read path)
    And the evaluator's captured input does not contain the preview

  @e2e @track2
  # Bound by blob-store.event-log.unit.test.ts + the rewritten integration test
  # in Step 4.
  Scenario: Trace-detail collapsed uses preview; "show full" JOINs event_log
    Given a trace with an over-threshold output was ingested
    When the trace-detail API reads the trace with full=false
    Then it returns the inline preview from the trace summary / stored_spans
    And no event_log JOIN occurs on this read
    When the trace-detail API reads the trace with full=true
    Then it returns the full output, resolved server-side via an event_log JOIN
    And the API response shape is unchanged from before the feature, requiring no frontend change

  @integration @track2 @unimplemented
  # Bound by blob-store.event-log.unit.test.ts (cross-tenant SELECT returns
  # empty) in Step 4.
  Scenario: Cross-tenant event_log read is structurally denied
    Given an event_log row stored under tenant A with EventId X
    When tenant B's read context attempts to SELECT event_log by EventId X
    Then the SELECT returns no rows
    Because the WHERE clause includes the requesting TenantId in the sort key prefix

  @integration @track2 @unimplemented
  # Bound by lean-for-projection.unit.test.ts + replay-projection-parity.integration.test.ts in Step 4.
  Scenario: leanForProjection is the single source of truth for the lean shape
    Given an event written to event_log via the live pipeline
    When the dispatch interposition derives the projection-queue payload
    And the replay executor derives the projection-handler argument for the same event
    Then both call sites invoke the same leanForProjection function
    And the derived shapes are byte-identical

  @integration @track2
  # Already bound to span-attribute-keys.unit.test.ts via the existing
  # @scenario annotation on its test cases. Carry forward from ADR-021.
  Scenario: Reserved namespace is excluded from user-visible facet enumeration
    Given a span carrying a "langwatch.reserved.eventref.langwatch.output" attribute
    When the Span Attribute Keys facet query is executed
    Then the returned facet keys do not contain any "langwatch.reserved." prefix
    And the facet query SQL contains "NOT startsWith(key, 'langwatch.reserved.')"

  # ===========================================================================
  # Cross-cutting
  # ===========================================================================

  @integration @cross-cutting @unimplemented
  # Bound by replay-projection-parity.integration.test.ts in Step 4.
  # This is the load-bearing invariant of ADR-022.
  Scenario: Replay produces byte-identical projection state as live ingestion
    Given a sequence of span events ingested via the live pipeline
    And the resulting trace_summaries and stored_spans rows are captured
    When the same event sequence is replayed from event_log
    Then the replayed trace_summaries row equals the live row byte-for-byte
    And the replayed stored_spans rows equal the live rows byte-for-byte
    Because leanForProjection is invoked at the same logical point in both paths

  @integration @cross-cutting @unimplemented
  # Bound by behavioural integration tests once the flag-gated edge path
  # gets a regression test in Step 4 follow-up. Note: the dispatch
  # interposition runs UNCONDITIONALLY by design — it's a defensive
  # content transformation (leaning is a no-op for sub-threshold IO).
  # Flag-off means no S3 spool is written and no on-the-wire behavior
  # changes; the interposition itself is server-internal.
  Scenario: With the flag off, ingestion and reads behave exactly as before
    Given the feature flag "release_trace_blob_offload" is disabled
    When a trace with a large output is ingested and then read back
    Then no S3 spool is written
    And the existing capOversizedAttributes(256 KB) is the only cap in effect
    And the trace-detail and list reads return the same shapes as before the feature

  # ===========================================================================
  # --- AC Coverage Map (ADR-022) ---
  # Track 1 — fold cache leanness
  # AC T1.1: "Fold cache stays bounded under heavy IO"
  #   -> Scenario: Folding a trace with a 1 MB output keeps the Redis cache entry lean
  # AC T1.2: "Trace-detail full read returns byte-identical IO"
  #   -> Scenario: Trace-detail full read returns input and output byte-identical to ingestion
  # AC T1.3: "Out-of-order refold + EvaluationTrigger reactor still produce correct state"
  #   -> Scenario: Out-of-order refold converges on the same state as in-order folding
  #   -> Scenario: EvaluationTrigger reactor fires correctly off the lean event
  #
  # Track 2 — event_log as SoT + spool + SDKs + read resolution
  # AC T2.1: "SDKs and gateway transmit full IO without truncation"
  #   -> Scenario Outline: SDK transmits a 50 KB output in full ... (Python SDK, TypeScript SDK)
  #   -> Scenario: Gateway forwards a payload larger than 32 KB without flagging truncation
  # AC T2.2: "Edge size-check + transient S3 spool (with fail-open)"
  #   -> Scenario: An over-threshold command is spooled to S3 transiently and reconstituted
  #   -> Scenario: When edge S3 spool PUT fails, ingestion falls back to inline (fail-open)
  # AC T2.3: "event_log carries the full event; projection queue carries the lean shape"
  #   -> Scenario: event_log carries the full event content; projection queue carries the lean shape
  # AC T2.4: "Online evaluator receives full output via event_log JOIN"
  #   -> Scenario: An online evaluator on an over-threshold trace receives the full output
  # AC T2.5: "Trace-detail collapsed uses preview; show-full JOINs event_log"
  #   -> Scenario: Trace-detail collapsed uses preview; "show full" JOINs event_log
  # AC T2.6: "Cross-tenant event_log read structurally denied"
  #   -> Scenario: Cross-tenant event_log read is structurally denied
  # AC T2.7: "leanForProjection is the single source of truth for the lean shape"
  #   -> Scenario: leanForProjection is the single source of truth for the lean shape
  # AC T2.8: "Reserved namespace excluded from user-visible enumerations"
  #   -> Scenario: Reserved namespace is excluded from user-visible facet enumeration
  #
  # Cross-cutting
  # AC X.1: "Replay parity — replay produces byte-identical projection state as live"
  #   -> Scenario: Replay produces byte-identical projection state as live ingestion
  # AC X.2: "Flag off = current behavior"
  #   -> Scenario: With the flag off, ingestion and reads behave exactly as before
  # AC X.3: "pnpm typecheck + test:unit + test:integration green; /prove-it; /review clean"
  #   -> CI/process gate, not a behavioral invariant.
  #
  # Count: 13 behavioral ACs (T1.1-3, T2.1-8, X.1-2) -> 15 scenarios (+1 Scenario Outline row
  # for the second SDK). X.3 is a process gate, intentionally not a scenario.
  # ===========================================================================

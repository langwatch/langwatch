Feature: Large trace payloads — lean fold cache + edge blob-offload to S3
  As the LangWatch ingestion pipeline handling large LLM trace payloads
  I want over-threshold field values offloaded once at the edge and the
  Redis fold cache kept lean (reductions + winner pointers, never IO text)
  So that Redis RAM and the single worker event loop stay healthy, full IO
  reaches online evaluators, and trace-detail reads stay byte-identical to
  what was ingested.

  # Issue #4215 — https://github.com/langwatch/langwatch/issues/4215
  #
  # Two linked problems, one fix. A large field's IO is materialized 5x on
  # ingestion (twice in Redis: the staged queue job + the write-through fold
  # cache; three times in ClickHouse: event log + two projections), and the
  # fold cache re-serializes the whole growing trace summary on every span
  # (~O(N^2) on the worker event loop). Meanwhile inputs/outputs are truncated
  # client-side (SDK 5 KB, gateway 32 KB / ADR-017) so online evaluators score
  # incomplete text. The fix: offload over-threshold field values once at the
  # edge (preview + reference inline, full bytes to org-scoped S3), keep the
  # fold cache lean, resolve refs server-side on read, and raise SDK/gateway
  # truncation defaults. Ships dark behind feature flag
  # `release_trace_blob_offload`; flag off = today's behavior. No frontend
  # change — refs are resolved transparently at the read boundary.
  #
  # Related ADRs: 007 (event sourcing), 015 (replay), 017 (gateway payload
  # capture / 32 KB cap), 014 (BullMQ -> fastq). New fold-cache-shape ADR
  # departs from ADR-007's "fold state = stored data".

  Background:
    Given the feature flag "release_trace_blob_offload" is enabled
    And the trace-processing pipeline is folding span events through the
        Redis-cached fold store with ClickHouse as the durable store
    And an offload threshold is configured for over-large field values

  # ===========================================================================
  # Track 1 — lean fold cache (Redis / event-loop relief)
  # ===========================================================================

  @e2e @track1 @unimplemented
  # Bound implicitly: edge offload (#4215 Track 2) bounds the winning span's
  # IO to a ≤32KB preview before the fold runs, so the fold cache is lean by
  # construction. Add a direct cache-size measurement test under
  # langwatch/src/server/event-sourcing/projections/__tests__/ to bind this.
  Scenario: Folding a trace with a 1 MB output keeps the Redis cache entry lean
    Given a trace whose span carries a 1 MB output value
    When all spans of the trace are folded into the trace summary
    Then the Redis fold cache entry "fold:...:{traceId}" is bounded under 2 KB
    And the cached JSON contains no computedInput or computedOutput payload
    And the cached JSON contains no events[] payload
    And the cached JSON still carries the reductions and winner-span pointers
        needed by the next fold step

  @e2e @track1
  Scenario: Trace-detail read returns input and output byte-identical to ingestion
    Given a trace with a large input and a large output was fully ingested
    When getTracesWithSpans is called for that trace
    Then the returned input is byte-identical to the ingested input
    And the returned output is byte-identical to the ingested output

  @integration @track1 @unimplemented
  # Covered by existing fold-projection tests (unchanged by this PR's design:
  # the fold's `apply` and `accumulateIO` were not modified). Add an explicit
  # bound test under event-sourcing/__tests__ for the offloaded-payload path.
  Scenario: Out-of-order refold converges on the same state as in-order folding
    Given the span events of a trace arrive out of their occurrence order
    When the trace is folded
    Then the resulting trace summary matches the state produced by folding the
        same events in occurrence order
    And the winning input, output, and root span pointers are unchanged

  @integration @track1 @unimplemented
  # Covered by existing EvaluationTrigger reactor tests; reactor inputs are
  # unchanged by this PR (the fold state shape is unchanged). Bind explicitly
  # once an integration test exercises trigger firing on offloaded traces.
  Scenario: EvaluationTrigger reactor fires correctly off the lean cached state
    Given a trace folds to a state that satisfies an evaluation trigger
    When the lean fold state is committed
    Then the EvaluationTrigger reactor observes the trigger condition
    And the evaluation is scheduled exactly as it is without the lean cache

  @unit @track1 @unimplemented
  # Pick-winning property of `accumulateIO` — non-winning span upserts do
  # not change `computedInput`/`computedOutput` on the trace summary. Held
  # by the existing fold logic (unmodified in this PR). ADR-021 §"Decision"
  # §1 ("`computedInput`/`computedOutput` are pick-winning"). Bind once a
  # regression-style test exercises a non-winner upsert against the fold.
  # NOTE (revised): an earlier draft of this scenario said "the heavy IO
  # is written to its own traceId-keyed row only on winner change" — that
  # described the REJECTED IO-split-table design (ADR-021 §"Superseded").
  # The chosen design keeps `computedInput`/`computedOutput` inline in
  # `trace_summaries` (as a preview after edge offload); there is no
  # separate IO row. Scenario rewritten to validate the chosen design.
  Scenario: A non-winning span upsert does not change the trace summary's computed IO
    Given a prior winning span already established the trace's computed output
    And a later non-winning span is folded
    When the durable trace-summary row is upserted
    Then `computedInput` and `computedOutput` on the trace summary are unchanged
    And the previously-recorded preview + reserved blob-ref are preserved as-is

  # ===========================================================================
  # Track 2 — edge offload, SDK/gateway defaults, server-side read resolution
  # ===========================================================================

  @e2e @track2 @unimplemented
  # Python SDK default raised to 32KB (constructor + public factory:
  # python-sdk/src/langwatch/telemetry/tracing.py:96, 786). TS SDK has no
  # transport-layer cap (grep confirms only CLI display helpers). Bind once
  # an end-to-end SDK→server test exercises the 50KB path.
  Scenario Outline: SDK transmits a 50 KB output in full without client-side truncation
    Given a <sdk> instrumented span produces a 50 KB output
    When the span is exported to LangWatch
    Then the received output is the full 50 KB
    And the received output contains no "(truncated string)" marker

    Examples:
      | sdk        |
      | Python SDK |
      | TypeScript SDK |

  @integration @track2 @unimplemented
  # Go AI Gateway (services/aigateway/) has no sdktrace.WithSpanLimits and
  # no manual truncation in customertracebridge/emitter.go; OTel Go SDK
  # v1.43.0 defaults to unlimited attribute value length. No code change
  # in this PR. Bind once a Go-side test pins the absence of a cap.
  Scenario: Gateway forwards a payload larger than 32 KB without flagging truncation
    Given the AI gateway receives a request whose captured payload exceeds 32 KB
    When the gateway records the payload for the trace
    Then the full payload is captured
    And the span is not annotated with "langwatch.input_truncated"

  @integration @track2
  Scenario: An over-threshold field is offloaded once with preview inline and ref recorded
    Given a span field value exceeds the offload threshold
    When the trace is collected at the ingestion edge
    Then the full bytes are stored once in S3 under a span-level manifest key "trace-blobs/{projectId}/{traceId}/{spanId}"
    And the stored_spans projection holds the bounded preview for that field
    And a reserved blob-ref attribute "langwatch.reserved.blobref.{attr}" carries the reference inside the span's attribute map
    And the queue job, event log, and trace summary carry only preview, ref, and scalars

  @integration @track2
  Scenario: Offloaded blob round-trips with byte integrity
    Given an over-threshold field value was offloaded to S3
    When the stored blob is fetched back by its reference
    Then sha256 of the fetched blob equals sha256 of the original value

  @e2e @track2
  Scenario: An online evaluator on an over-threshold trace receives the full output
    Given an online evaluator is configured for a trace whose output exceeds the threshold
    When the evaluation executes
    Then the evaluator's captured input contains the full output
    And the evaluator's captured input does not contain the preview

  @e2e @track2
  Scenario: Trace-detail resolves refs to full IO while list and search use the preview
    Given a trace with an over-threshold output was ingested
    When the trace-detail API reads the trace
    Then it returns the full output with refs resolved server-side
    When the list or search surface reads the trace
    Then it returns the inline preview from the trace summary
    And no S3 fetch occurs on the list or search path
    And the API response shape is unchanged from before the feature, requiring no frontend change

  @integration @track2 @unimplemented
  # Per-org BYOC bucket: resolver returns the caller's org bucket, so a
  # cross-org key resolves NoSuchKey. Shared-bucket mode (BYOC not
  # configured) relies on API-enforced auth: the caller's authenticated
  # projectId is encoded in the key prefix. The current unit test covers
  # the per-org-bucket case only; a shared-bucket test that proves
  # API-boundary denial is the follow-up that binds this scenario.
  Scenario: A cross-project blob fetch is denied
    Given a blob stored under project A's key "trace-blobs/{projectA}/{traceId}/{spanId}"
    When project B attempts to fetch that key
    Then the fetch is denied
    And no bytes from project A are returned

  # ===========================================================================
  # Cross-cutting — feature flag
  # ===========================================================================

  @integration @cross-cutting
  Scenario: With the flag off, ingestion and reads behave exactly as before
    Given the feature flag "release_trace_blob_offload" is disabled
    When a trace with a large output is ingested and then read back
    Then no field value is offloaded to S3
    And the fold cache and durable rows carry IO inline as they do today
    And the trace-detail and list reads return the same shapes as before the feature

  # ===========================================================================
  # --- AC Coverage Map ---
  # Track 1 — Redis / fold cache
  # AC T1.1: "Folding a >=1 MB output -> STRLEN fold cache bounded (<2 KB), no
  #          computedInput/Output/events[] payload"
  #   -> Scenario: Folding a trace with a 1 MB output keeps the Redis cache entry lean
  # AC T1.2: "getTracesWithSpans(traceId) returns output/input byte-identical to ingested"
  #   -> Scenario: Trace-detail read returns input and output byte-identical to ingestion
  # AC T1.3: "Out-of-order refold + EvaluationTrigger reactor still produce correct state"
  #   -> Scenario: Out-of-order refold converges on the same state as in-order folding
  #   -> Scenario: EvaluationTrigger reactor fires correctly off the lean cached state
  #   (supporting) Scenario: A non-winning span upsert does not carry IO text into the hot summary row
  #
  # Track 2 — offload / fidelity
  # AC T2.1: "SDK (Python AND TS) transmits a 50 KB output in full; gateway passes
  #          >32 KB without langwatch.input_truncated"
  #   -> Scenario Outline: SDK transmits a 50 KB output in full ... (Python SDK, TypeScript SDK)
  #   -> Scenario: Gateway forwards a payload larger than 32 KB without flagging truncation
  # AC T2.2: "Field > threshold stored once in S3 at trace-blobs/{projectId}/{traceId}/{spanId} (span manifest);
  #          stored_spans holds preview; ref rides as a reserved span attribute
  #          `langwatch.reserved.blobref.{attr}` with field selector (no schema change to the projection)"
  #   -> Scenario: An over-threshold field is offloaded once with preview inline and ref recorded
  # AC T2.3: "Round-trip integrity: sha256(S3 blob) == sha256(original)"
  #   -> Scenario: Offloaded blob round-trips with byte integrity
  # AC T2.4: "Online eval on a >threshold trace receives the full output, not the preview"
  #   -> Scenario: An online evaluator on an over-threshold trace receives the full output
  # AC T2.5: "Trace-detail read returns full IO (server-resolved refs); list/search return
  #          inline preview (no S3). No frontend change — verified at the API boundary"
  #   -> Scenario: Trace-detail resolves refs to full IO while list and search use the preview
  # AC T2.6: "Cross-tenant blob fetch (org A -> org B key) is denied"
  #   -> Scenario: A cross-tenant blob fetch is denied
  #
  # Cross-cutting
  # AC X.1: "All behind feature flag release_trace_blob_offload; flag off = current behavior"
  #   -> Scenario: With the flag off, ingestion and reads behave exactly as before
  #   (and the Background enables the flag for every other scenario)
  # AC X.2: "pnpm typecheck + test:unit + test:integration green; /prove-it maps each AC
  #          to evidence; /review clean"
  #   -> CI/process gate, not a behavioral invariant. Satisfied by the test suite that
  #      binds the scenarios above plus the existing event-sourcing suites staying green;
  #      not modeled as a standalone scenario.
  #
  # Count: 11 behavioral ACs (T1.1-3, T2.1-6, X.1) -> 12 scenarios (+1 Scenario Outline
  # row for the second SDK). X.2 is a process gate, intentionally not a scenario.
  # ===========================================================================

Feature: Online-evaluator infinite-loop prevention
  As a customer running online evaluators (monitors) on traces
  I want evaluator-emitted telemetry to never re-trigger the same evaluator
  So that a "run on every trace" monitor cannot recurse infinitely when the
  evaluator implementation itself emits traces (e.g. nlpgo workflow runs).

  # Why this exists — incident 2026-05-11
  #
  # An internal project had a monitor configured to run on EVERY trace
  # (no preconditions). After migrating that project to nlpgo, the
  # evaluator workflow started emitting its own traces, each of which
  # the same monitor picked up. In ~90 min the loop produced ~500K
  # event-sourcing groups, starving every other tenant.
  #
  # Design: a numeric "causality depth" counter that increments at every
  # evaluator-workflow boundary. The reactor refuses to dispatch when
  # the inbound span carries depth >= 1.
  #
  # Single guarantee: nlpgo's BaggageAttributeProcessor stamps
  # `langwatch.reserved.causality_depth = N+1` on EVERY span emitted
  # during an evaluator run, via a context baggage entry that propagates
  # automatically through child spans and goroutines. The TS reactor
  # then reads the inbound span's attribute and skips dispatch when
  # depth >= 1.
  #
  # A fresh app-origin span (depth 0) arriving later on the same trace
  # DOES dispatch normally — only eval-emitted spans are blocked.
  #
  # Origin is NOT hardcoded in the reactor. It remains a
  # user-configurable precondition matcher (default UI precondition
  # `origin=application`, customer can remove). Depth is the sole
  # hard signal.
  #
  # Counter `langwatch_evaluator_loop_blocked_total{reason}` so a
  # healthy fleet sees this at ~zero.

  Background:
    Given the trace-processing pipeline is running
    And the evaluationTrigger reactor processes trace events

  @integration @unit @loop-prevention @depth-direct
  Scenario: Incoming span with causality_depth=1 does not trigger evaluations
    Given a span_received event arrives with attribute "langwatch.reserved.causality_depth" = "1"
    And the project has an enabled ON_MESSAGE monitor with no preconditions
    When the evaluationTrigger reactor fires for this event
    Then no executeEvaluation command is dispatched
    And the loop-blocked counter is incremented with reason="depth_direct"

  @integration @unit @loop-prevention @depth-direct
  Scenario: Incoming span with causality_depth=0 still triggers evaluations
    Given a span_received event arrives with attribute "langwatch.reserved.causality_depth" = "0"
    And the project has an enabled ON_MESSAGE monitor with no preconditions
    When the evaluationTrigger reactor fires for this event
    Then one executeEvaluation command is dispatched per monitor

  @integration @unit @loop-prevention @depth-missing
  Scenario: Incoming span with no causality_depth attribute is treated as depth 0
    Given a span_received event arrives with no "langwatch.reserved.causality_depth" attribute
    And the project has an enabled ON_MESSAGE monitor with no preconditions
    When the evaluationTrigger reactor fires for this event
    Then one executeEvaluation command is dispatched per monitor

  @integration @loop-prevention @depth-direct
  Scenario: Causality guard is per-span — fresh app activity still re-triggers
    Given a span_received event arrives with depth=0 and the reactor dispatches evaluation
    And a second span_received event arrives on the same trace with depth=1
    And the reactor blocks dispatch for the depth=1 event
    When a third span_received event arrives on the same trace with depth=0
    Then the reactor dispatches evaluation again for the third event
    # The guard is per-span, not per-trace. New legitimate app activity on
    # an already-evaluated trace must still trigger evaluation — only the
    # evaluator's own emitted spans (depth>=1) are blocked.

  @unit @loop-prevention @depth-direct
  Scenario: Reserved causality_depth attribute passes through strip
    Given recordSpan strips user-submitted langwatch.reserved.* attributes
    When a span arrives carrying langwatch.reserved.causality_depth=1
    Then the attribute survives stripping
    And the emitted span_received event carries the depth attribute
    # The original 2026-05-11 fix was silently disabled in production
    # because recordSpan's strip nuked the very attribute the reactor
    # uses for loop detection. The fix adds a narrow passthrough
    # allowlist; this scenario pins the attribute name as load-bearing.

  @integration @unit @loop-prevention @kill-switch
  Scenario: LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD bypasses depth check
    Given the env var "LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD" is set to "1"
    And a span_received event arrives with depth=1
    When the evaluationTrigger reactor fires
    Then executeEvaluation IS dispatched (guard bypassed)
    And a warning is logged that the guard is disabled

  # ============================================================================
  # TS-side dispatch: traceparent + parent-span context propagation to nlpgo.
  #
  # The eval-execution service runs in TS. It calls nlpgoFetch to dispatch
  # the eval workflow. For nlpgo's emitted spans to land as children of the
  # parent trace (not as a separate orphan trace — the 2026-05-14 prod bug),
  # nlpgoFetch must send a valid W3C `traceparent` header derived from the
  # parent trace's root span.
  # ============================================================================

  @unit @loop-prevention @traceparent
  Scenario: formatTraceparent builds a valid W3C traceparent header
    Given traceId is a 32-hex string
    And parentSpanId is a 16-hex string
    When formatTraceparent is called
    Then the result is "00-<traceId>-<parentSpanId>-01"

  @unit @loop-prevention @traceparent
  Scenario: formatTraceparent rejects malformed traceId
    Given a non-32-hex traceId
    When formatTraceparent is called
    Then it throws (loud failure — silent broken header would orphan traces in prod)

  @unit @loop-prevention @traceparent
  Scenario: formatTraceparent rejects malformed parentSpanId
    Given a non-16-hex parentSpanId
    When formatTraceparent is called
    Then it throws

  @unit @loop-prevention @traceparent
  Scenario: extractParentTraceForNlpgo returns context for valid OTel trace
    Given the parent trace has a 32-hex trace_id and a 16-hex root span_id
    When extractParentTraceForNlpgo runs
    Then it returns the lowercased trace_id and root span_id

  @unit @loop-prevention @traceparent
  Scenario: extractParentTraceForNlpgo returns undefined for legacy trace_id shapes
    Given the parent trace has a legacy trace_<nanoid> trace_id
    When extractParentTraceForNlpgo runs
    Then it returns undefined
    # nlpgo falls back to body-supplied trace_id when no traceparent header
    # arrives — better than synthesizing a parent_span_id that would
    # render under a non-existent span in Studio's waterfall.

  # ============================================================================
  # nlpgo-side guarantees (Go tests live in services/nlpgo/...)
  # ============================================================================

  @go @nlpgo @propagation
  Scenario: nlpgo handler extracts traceparent header and continues parent trace
    Given a POST to /go/studio/execute_sync with header "traceparent: 00-<traceId>-<spanId>-01"
    When nlpgo creates its root studio span
    Then the studio span shares trace_id with the parent
    And the studio span's parent_span_id equals the header's span_id

  @go @nlpgo @depth-increment
  Scenario: nlpgo handler increments causality_depth on its root span
    Given a POST to /go/studio/execute_sync with header "X-LangWatch-Causality-Depth: 0"
    When nlpgo creates its root studio span
    Then the root span attribute "langwatch.reserved.causality_depth" equals "1"

  @go @nlpgo @span-processor
  Scenario: Every span emitted during an nlpgo evaluator run carries causality_depth via SpanProcessor
    Given a POST to /go/studio/execute_sync with header "X-LangWatch-Causality-Depth: 0"
    When nlpgo runs the evaluator workflow producing multiple child and grandchild spans
    Then every emitted span (root, child, grandchild) carries attribute "langwatch.reserved.causality_depth" = "1"

  @go @nlpgo @outbound
  Scenario: Outbound HTTP from nlpgo evaluator block carries traceparent + baggage + depth header
    Given an nlpgo evaluator block makes an outbound HTTP call
    Then the outbound request carries header "traceparent"
    And carries header "baggage" containing "langwatch.reserved.causality_depth"
    And carries header "X-LangWatch-Causality-Depth" with the current depth

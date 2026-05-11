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
  # the inbound span (or any of its ancestors on this trace) carries
  # depth >= 1.
  #
  # Two layers of defense, both ship together (belt-and-suspenders):
  #
  #   1. nlpgo SpanProcessor stamps `langwatch.causality_depth = N+1`
  #      on EVERY span emitted during an evaluator run, via a context
  #      baggage entry that propagates automatically through child
  #      spans and goroutines. Primary defense.
  #
  #   2. TS reactor maintains a `causalSubtreeSpans: Set<spanId>` in
  #      the trace-summary fold. A span enters the set if its own attr
  #      is >= 1, OR its parent_span_id is already in the set. The
  #      reactor skips dispatch when the inbound span is in the set.
  #      Catches the case where a child span arrives before its parent
  #      (async exporters) or where the SpanProcessor wiring missed a
  #      span path.
  #
  # Re-trigger policy: a fresh app-origin span (depth 0, parent not in
  # the eval subtree) arriving later on the same trace DOES dispatch
  # normally. Only the eval-subtree updates are blocked.
  #
  # Origin is NOT hardcoded in the reactor. It remains a
  # user-configurable precondition matcher (default UI precondition
  # `origin=application`, customer can remove). Depth is the sole
  # hard signal.
  #
  # Counter `langwatch_causality_loop_blocked_total{tenant_id,reason}`
  # so a healthy fleet sees this at ~zero.

  Background:
    Given the trace-processing pipeline is running
    And the evaluationTrigger reactor processes trace events

  @integration @unit @loop-prevention @depth-direct
  Scenario: Incoming span with causality_depth=1 does not trigger evaluations
    Given a span_received event arrives with attribute "langwatch.causality_depth" = "1"
    And the project has an enabled ON_MESSAGE monitor with no preconditions
    When the evaluationTrigger reactor fires for this event
    Then no executeEvaluation command is dispatched
    And the loop-blocked counter is incremented with reason="depth_direct"

  @integration @unit @loop-prevention @depth-direct
  Scenario: Incoming span with causality_depth=0 still triggers evaluations
    Given a span_received event arrives with attribute "langwatch.causality_depth" = "0"
    And the project has an enabled ON_MESSAGE monitor with no preconditions
    When the evaluationTrigger reactor fires for this event
    Then one executeEvaluation command is dispatched per monitor

  @integration @unit @loop-prevention @depth-missing
  Scenario: Incoming span with no causality_depth attribute is treated as depth 0
    Given a span_received event arrives with no "langwatch.causality_depth" attribute
    And the project has an enabled ON_MESSAGE monitor with no preconditions
    When the evaluationTrigger reactor fires for this event
    Then one executeEvaluation command is dispatched per monitor

  @integration @unit @loop-prevention @parent-walk
  Scenario: Child span without depth attribute, but whose parent is in the eval subtree, is blocked
    Given a span_received event previously added span "S1" to causalSubtreeSpans (depth=1)
    And a new span_received event arrives for span "S2" with parent_span_id="S1"
    And "S2" has no "langwatch.causality_depth" attribute
    When the evaluationTrigger reactor fires for "S2"
    Then no executeEvaluation command is dispatched
    And the loop-blocked counter is incremented with reason="parent_in_subtree"
    And "S2" is added to causalSubtreeSpans

  @integration @unit @loop-prevention @re-trigger
  Scenario: Fresh app-origin span on a trace that already has eval spans still dispatches
    Given a trace previously received eval spans (depth=1) for monitor M1
    And causalSubtreeSpans contains those span IDs
    When a new span_received event arrives with depth=0 and parent_span_id NOT in causalSubtreeSpans
    Then one executeEvaluation command is dispatched for M1

  @integration @unit @loop-prevention @kill-switch
  Scenario: LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD bypasses both checks
    Given the env var "LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD" is set to "1"
    And a span_received event arrives with depth=1
    When the evaluationTrigger reactor fires
    Then executeEvaluation IS dispatched (guard bypassed)
    And a warning is logged that the guard is disabled

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
    Then the root span attribute "langwatch.causality_depth" equals "1"

  @go @nlpgo @span-processor
  Scenario: Every span emitted during an nlpgo evaluator run carries causality_depth via SpanProcessor
    Given a POST to /go/studio/execute_sync with header "X-LangWatch-Causality-Depth: 0"
    When nlpgo runs the evaluator workflow producing multiple child and grandchild spans
    Then every emitted span (root, child, grandchild) carries attribute "langwatch.causality_depth" = "1"

  @go @nlpgo @outbound
  Scenario: Outbound HTTP from nlpgo evaluator block carries traceparent + baggage + depth header
    Given an nlpgo evaluator block makes an outbound HTTP call
    Then the outbound request carries header "traceparent"
    And carries header "baggage" containing "langwatch.causality_depth"
    And carries header "X-LangWatch-Causality-Depth" with the current depth

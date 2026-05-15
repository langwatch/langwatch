Feature: nlpgo emits a TRUE root span when no inbound traceparent is supplied
  As an operator inspecting a Studio playground trace in the LangWatch UI
  I want every workflow root row to render as an actual root of the trace
  So that I don't see misleading "Parent not in trace" warnings on legitimate
  playground / component / evaluation runs

  # ===========================================================================
  # 2026-05-15 prod regression
  # ===========================================================================
  #
  # Studio's playground frontend mints a trace_id (32-hex) and ships it in the
  # request BODY only — no W3C `traceparent` HTTP header. nlpgo needs that
  # trace_id for continuity (the LangWatch "Full Trace" drawer pivots on it).
  #
  # The pre-fix path in services/nlpgo/adapters/httpapi/tracing.go synthesized
  # a remote SpanContext with a FRESHLY RANDOM SpanID as the "parent" so the
  # in-process span chain would inherit the body trace_id. The studio root
  # then carried parent_span_id = <random phantom> in OTLP — a span that is
  # never emitted anywhere. The LangWatch UI surfaced this on every playground
  # row as ⚠ "Parent not in trace", with a different random parent per run.
  #
  # Fix: a context-aware OTel IDGenerator (pkg/otelsetup/idgenerator.go) lets
  # callers seed the next root span's trace_id via a context value. When no
  # inbound traceparent is present, startStudioSpan calls WithTraceIDOverride
  # and lets tracer.Start fall through the no-parent path. The studio span
  # comes out as a TRUE root: parent context invalid, parent_span_id all-zeros
  # in OTLP, trace_id == body trace_id.

  Background:
    Given nlpgo is the trace-emitter for Studio workflow runs
    And the global TracerProvider is configured with the context-aware IDGenerator

  @go @nlpgo
  Scenario: Studio playground request with body trace_id but no traceparent header creates a true root span
    Given the frontend POSTs /go/studio/execute_sync with a 32-hex trace_id in the body
    And the request carries no W3C traceparent header
    When nlpgo invokes startStudioSpan
    Then the emitted studio root span has parent_span_id = all-zeros
    And the emitted studio root span has trace_id equal to the body trace_id
    And the LangWatch UI does not surface "Parent not in trace" against the row

  @go @nlpgo
  Scenario: Evaluator workflows with traceparent header still continue the parent trace
    Given the eval dispatcher POSTs /go/studio/execute_sync with a W3C traceparent header
    And the request also carries a body trace_id matching the traceparent's trace-id
    When nlpgo invokes startStudioSpan
    Then the emitted studio root span has parent_span_id equal to the inbound traceparent span-id
    And the emitted studio root span has trace_id equal to the inbound traceparent trace-id
    Because the in-context SpanContext extracted via the global propagator takes priority over the body trace_id

  @go @nlpgo
  Scenario: Context-aware IDGenerator only affects spans started without a valid parent
    Given a child span is started in a context that already has a valid parent SpanContext
    And the same context also carries a trace_id override via WithTraceIDOverride
    When tracer.Start runs
    Then the SDK inherits trace_id from the parent SpanContext
    And the IDGenerator override is ignored
    Because OTel only calls IDGenerator.NewIDs for spans without a valid parent

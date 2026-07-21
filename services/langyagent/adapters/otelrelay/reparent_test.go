package otelrelay

import (
	"testing"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

var (
	turnTraceID = trace.TraceID{0xAA, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}
	turnSpanID  = trace.SpanID{0xBB, 1, 2, 3, 4, 5, 6, 7}
)

func turnContext() trace.SpanContext {
	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    turnTraceID,
		SpanID:     turnSpanID,
		TraceFlags: trace.FlagsSampled,
	})
}

// workerBatch builds a two-span batch as opencode would export it: a root span
// (its own trace, no parent) with one child.
func workerBatch() (ptrace.Traces, pcommon.SpanID, pcommon.SpanID) {
	td := ptrace.NewTraces()
	ss := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty()

	workerTrace := pcommon.TraceID{9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9}
	rootID := pcommon.SpanID{1, 1, 1, 1, 1, 1, 1, 1}
	childID := pcommon.SpanID{2, 2, 2, 2, 2, 2, 2, 2}

	root := ss.Spans().AppendEmpty()
	root.SetName("ai.streamText")
	root.SetTraceID(workerTrace)
	root.SetSpanID(rootID)

	child := ss.Spans().AppendEmpty()
	child.SetName("ai.toolCall")
	child.SetTraceID(workerTrace)
	child.SetSpanID(childID)
	child.SetParentSpanID(rootID)

	return td, rootID, childID
}

func TestReparentTraces(t *testing.T) {
	t.Run("when a turn trace context is known", func(t *testing.T) {
		td, rootID, childID := workerBatch()

		ReparentTraces(td, "conv-123", "user-1", turnContext())

		spans := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
		root, child := spans.At(0), spans.At(1)

		// Every span rides the turn's trace id.
		for i, span := range []ptrace.Span{root, child} {
			if span.TraceID() != pcommon.TraceID(turnTraceID) {
				t.Errorf("span %d trace id = %v, want the turn's %v", i, span.TraceID(), turnTraceID)
			}
		}
		// The root is parented on the turn's span; the child keeps its own parent.
		if root.ParentSpanID() != pcommon.SpanID(turnSpanID) {
			t.Errorf("root parent = %v, want turn span %v", root.ParentSpanID(), turnSpanID)
		}
		if child.ParentSpanID() != rootID {
			t.Errorf("child parent = %v, want its original root %v (internal hierarchy preserved)", child.ParentSpanID(), rootID)
		}
		// Span ids themselves are untouched.
		if root.SpanID() != rootID || child.SpanID() != childID {
			t.Errorf("span ids must be preserved; got %v/%v", root.SpanID(), child.SpanID())
		}

		attrs := td.ResourceSpans().At(0).Resource().Attributes()
		if v, _ := attrs.Get("langwatch.thread.id"); v.AsString() != "conv-123" {
			t.Errorf("langwatch.thread.id = %q, want conv-123", v.AsString())
		}
		if v, _ := attrs.Get("tag.tags"); v.AsString() != "langy" {
			t.Errorf("tag.tags = %q, want langy", v.AsString())
		}
	})

	t.Run("when no turn context has been recorded yet", func(t *testing.T) {
		td, rootID, _ := workerBatch()
		originalTrace := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0).TraceID()

		ReparentTraces(td, "conv-123", "user-1", trace.SpanContext{})

		spans := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
		if spans.At(0).TraceID() != originalTrace {
			t.Errorf("with no valid turn the batch's trace ids must be forwarded unmodified")
		}
		if !spans.At(0).ParentSpanID().IsEmpty() {
			t.Errorf("with no valid turn the root must stay a root, got parent %v", spans.At(0).ParentSpanID())
		}
		if spans.At(1).ParentSpanID() != rootID {
			t.Errorf("child parent must be untouched")
		}
		// Resource stamping still applies: the batch must land labeled + grouped.
		attrs := td.ResourceSpans().At(0).Resource().Attributes()
		if v, _ := attrs.Get("langwatch.thread.id"); v.AsString() != "conv-123" {
			t.Errorf("thread id stamp must apply regardless of turn context")
		}
	})

	t.Run("when the worker already set tag.tags", func(t *testing.T) {
		td, _, _ := workerBatch()
		td.ResourceSpans().At(0).Resource().Attributes().PutStr("tag.tags", "custom")

		ReparentTraces(td, "conv-123", "user-1", turnContext())

		attrs := td.ResourceSpans().At(0).Resource().Attributes()
		if v, _ := attrs.Get("tag.tags"); v.AsString() != "custom,langy" {
			t.Errorf("tag.tags = %q, want the langy tag appended to the existing one", v.AsString())
		}
	})
}

func TestReparentOTLP_RoundTripsProtobuf(t *testing.T) {
	td, _, _ := workerBatch()
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}

	out, err := ReparentOTLP(payload, "conv-9", "user-1", turnContext())
	if err != nil {
		t.Fatalf("ReparentOTLP: %v", err)
	}
	got, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(out)
	if err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	span := got.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
	if span.TraceID() != pcommon.TraceID(turnTraceID) {
		t.Errorf("round-tripped trace id = %v, want the turn's", span.TraceID())
	}

	if _, err := ReparentOTLP([]byte("not-protobuf"), "conv-9", "user-1", turnContext()); err == nil {
		t.Errorf("garbage payload must error, not forward")
	}
}

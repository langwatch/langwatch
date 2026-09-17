package httpapi

import (
	"context"
	"testing"

	otelapi "go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// installRecordingProvider swaps the global tracer provider for one that
// records into an in-memory exporter under the production default sampler
// (parent-based, sample everything) wrapped in SuppressAwareSampler (as
// production does), and restores the previous provider when the test ends.
func installRecordingProvider(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exp := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exp),
		sdktrace.WithSampler(otelsetup.NewSuppressAwareSampler(
			sdktrace.ParentBased(sdktrace.AlwaysSample()),
		)),
	)
	prev := otelapi.GetTracerProvider()
	otelapi.SetTracerProvider(tp)
	t.Cleanup(func() { otelapi.SetTracerProvider(prev) })
	return exp
}

// installNonParentBasedProvider installs a provider with a non-parent-based
// sampler wrapped in SuppressAwareSampler. This is the configuration that
// broke before the context-marker fix: AlwaysSample ignores the parent's
// sampled bit, so only the suppression marker prevents export.
func installNonParentBasedProvider(t *testing.T, sampler sdktrace.Sampler) *tracetest.InMemoryExporter {
	t.Helper()
	exp := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exp),
		sdktrace.WithSampler(otelsetup.NewSuppressAwareSampler(sampler)),
	)
	prev := otelapi.GetTracerProvider()
	otelapi.SetTracerProvider(tp)
	t.Cleanup(func() { otelapi.SetTracerProvider(prev) })
	return exp
}

// TestStartStudioSpan_DoNotTrace_SuppressesDescendants pins that
// DoNotTrace silences the whole request, not only the top span: a span
// started from the returned context (the engine's per-node spans) must
// not be exported. Before the fix the returned context carried no span,
// so the first descendant became a fresh sampled root with a random
// trace id — a one-span orphan trace per suppressed request.
func TestStartStudioSpan_DoNotTrace_SuppressesDescendants(t *testing.T) {
	exp := installRecordingProvider(t)

	req := &app.WorkflowRequest{TraceID: "trace_legacyShapedId", DoNotTrace: true, Type: "execute_flow"}
	ctx, root := startStudioSpan(context.Background(), req, "key")

	_, child := otelapi.Tracer(tracerName).Start(ctx, "Code")
	child.End()
	root.End()

	if got := exp.GetSpans(); len(got) != 0 {
		t.Fatalf("exported %d span(s) under DoNotTrace, want 0: %+v", len(got), got.Snapshots())
	}
}

// TestStartStudioSpan_DoNotTrace_SuppressesDescendantsUnderInboundParent
// covers the sub-workflow path: the caller already owns a sampled trace
// and asked for no inner spans. Descendants must not attach to it.
func TestStartStudioSpan_DoNotTrace_SuppressesDescendantsUnderInboundParent(t *testing.T) {
	exp := installRecordingProvider(t)

	parent := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{0x0a, 0xf7, 0x65, 0x19, 0x16, 0xcd, 0x43, 0xdd, 0x84, 0x48, 0xeb, 0x21, 0x1c, 0x80, 0x31, 0x9c},
		SpanID:     trace.SpanID{0xb7, 0xad, 0x6b, 0x71, 0x69, 0x20, 0x33, 0x31},
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	inbound := trace.ContextWithRemoteSpanContext(context.Background(), parent)

	req := &app.WorkflowRequest{TraceID: parent.TraceID().String(), DoNotTrace: true, Type: "execute_flow"}
	ctx, root := startStudioSpan(inbound, req, "key")

	_, child := otelapi.Tracer(tracerName).Start(ctx, "Code")
	child.End()
	root.End()

	if got := exp.GetSpans(); len(got) != 0 {
		t.Fatalf("exported %d span(s) under DoNotTrace, want 0: %+v", len(got), got.Snapshots())
	}
}

// TestStartStudioSpan_Tracing_DescendantsStillEmit guards the other
// direction: without DoNotTrace the per-node span is exported under the
// studio root, so the suppression cannot leak into the normal path.
func TestStartStudioSpan_Tracing_DescendantsStillEmit(t *testing.T) {
	exp := installRecordingProvider(t)

	req := &app.WorkflowRequest{TraceID: "0af7651916cd43dd8448eb211c80319c", DoNotTrace: false, Type: "execute_flow"}
	ctx, root := startStudioSpan(context.Background(), req, "key")

	_, child := otelapi.Tracer(tracerName).Start(ctx, "Code")
	child.End()
	root.End()

	got := exp.GetSpans()
	if len(got) != 2 {
		t.Fatalf("exported %d span(s), want 2 (root + node)", len(got))
	}
	if got[0].Parent.SpanID() != got[1].SpanContext.SpanID() {
		t.Fatalf("node span parent %s != root span %s", got[0].Parent.SpanID(), got[1].SpanContext.SpanID())
	}
}

// TestStartStudioSpan_DoNotTrace_SuppressesUnderAlwaysSample covers
// the gap the P2 review found: with a non-parent-based AlwaysSample
// sampler, the unsampled-parent trick alone does not suppress spans.
// The context suppression marker must enforce the drop.
func TestStartStudioSpan_DoNotTrace_SuppressesUnderAlwaysSample(t *testing.T) {
	exp := installNonParentBasedProvider(t, sdktrace.AlwaysSample())

	req := &app.WorkflowRequest{TraceID: "trace_legacyShapedId", DoNotTrace: true, Type: "execute_flow"}
	ctx, root := startStudioSpan(context.Background(), req, "key")

	_, child := otelapi.Tracer(tracerName).Start(ctx, "Code")
	child.End()
	root.End()

	if got := exp.GetSpans(); len(got) != 0 {
		t.Fatalf("exported %d span(s) under DoNotTrace+AlwaysSample, want 0: %+v", len(got), got.Snapshots())
	}
}

// TestStartStudioSpan_DoNotTrace_SuppressesUnderTraceIDRatio covers
// the same gap with a non-parent-based TraceIDRatioBased(1.0) sampler
// (samples everything, ignores parent flags).
func TestStartStudioSpan_DoNotTrace_SuppressesUnderTraceIDRatio(t *testing.T) {
	exp := installNonParentBasedProvider(t, sdktrace.TraceIDRatioBased(1.0))

	req := &app.WorkflowRequest{TraceID: "trace_legacyShapedId", DoNotTrace: true, Type: "execute_flow"}
	ctx, root := startStudioSpan(context.Background(), req, "key")

	_, child := otelapi.Tracer(tracerName).Start(ctx, "Code")
	child.End()
	root.End()

	if got := exp.GetSpans(); len(got) != 0 {
		t.Fatalf("exported %d span(s) under DoNotTrace+TraceIDRatio(1.0), want 0: %+v", len(got), got.Snapshots())
	}
}

// TestStartStudioSpan_Tracing_EmitsUnderAlwaysSample guards that
// the suppression wrapper does not interfere with normal tracing
// under a non-parent-based sampler.
func TestStartStudioSpan_Tracing_EmitsUnderAlwaysSample(t *testing.T) {
	exp := installNonParentBasedProvider(t, sdktrace.AlwaysSample())

	req := &app.WorkflowRequest{TraceID: "0af7651916cd43dd8448eb211c80319c", DoNotTrace: false, Type: "execute_flow"}
	ctx, root := startStudioSpan(context.Background(), req, "key")

	_, child := otelapi.Tracer(tracerName).Start(ctx, "Code")
	child.End()
	root.End()

	got := exp.GetSpans()
	if len(got) != 2 {
		t.Fatalf("exported %d span(s), want 2 (root + node)", len(got))
	}
}

// Context-aware ID generator: lets callers seed the trace_id for the
// next OTel root span via a context value, while keeping random IDs for
// every other span. This is the mechanism that lets nlpgo's
// startStudioSpan honour a body-supplied trace_id and STILL produce a
// TRUE root span (parent_span_id = zero) — fixing the 2026-05-15
// regression where playground workflow roots showed "Parent not in
// trace" because the previous code synthesised a phantom remote parent
// SpanContext for trace-id continuity.

package otelsetup

import (
	"context"
	"encoding/binary"
	"math/rand/v2"

	"go.opentelemetry.io/otel/sdk/trace"
	apitrace "go.opentelemetry.io/otel/trace"
)

// traceIDOverrideKey is the context key under which callers stash a
// pre-chosen TraceID. Unexported — go through WithTraceIDOverride so
// the type sentinel can't collide with anything else.
type traceIDOverrideKey struct{}

// WithTraceIDOverride returns a derived context that pins the next OTel
// root span's trace_id to tid. Only takes effect for spans started with
// no valid parent SpanContext in the context — for child spans the SDK
// inherits trace_id from the parent and doesn't consult the IDGenerator.
//
// Use this when an upstream caller (e.g. Studio's frontend) supplies a
// trace_id out-of-band and you want the resulting OTel root span to
// adopt it WITHOUT inventing a phantom parent span_id.
func WithTraceIDOverride(ctx context.Context, tid apitrace.TraceID) context.Context {
	if !tid.IsValid() {
		return ctx
	}
	return context.WithValue(ctx, traceIDOverrideKey{}, tid)
}

// traceIDFromContext extracts the override if one is set.
func traceIDFromContext(ctx context.Context) (apitrace.TraceID, bool) {
	v := ctx.Value(traceIDOverrideKey{})
	if v == nil {
		return apitrace.TraceID{}, false
	}
	tid, ok := v.(apitrace.TraceID)
	if !ok || !tid.IsValid() {
		return apitrace.TraceID{}, false
	}
	return tid, true
}

// ContextAwareIDGenerator is a drop-in for the SDK's default random
// generator that honours WithTraceIDOverride on NewIDs. Span IDs are
// always random — pinning span_id across processes is never the right
// move and would silently corrupt the trace tree.
type ContextAwareIDGenerator struct{}

var _ trace.IDGenerator = (*ContextAwareIDGenerator)(nil)

// NewIDGenerator returns the canonical context-aware generator.
func NewIDGenerator() *ContextAwareIDGenerator {
	return &ContextAwareIDGenerator{}
}

// NewIDs is called by the SDK when starting a span with no valid
// parent SpanContext in ctx. We honour the trace_id override (if any)
// and always mint a fresh span_id.
func (g *ContextAwareIDGenerator) NewIDs(ctx context.Context) (apitrace.TraceID, apitrace.SpanID) {
	if tid, ok := traceIDFromContext(ctx); ok {
		return tid, randomSpanID()
	}
	return randomTraceID(), randomSpanID()
}

// NewSpanID is called when starting a child span. The trace_id is
// already determined by the parent; we just need a fresh span_id.
func (g *ContextAwareIDGenerator) NewSpanID(_ context.Context, _ apitrace.TraceID) apitrace.SpanID {
	return randomSpanID()
}

// randomTraceID mirrors the SDK's default behaviour for the random
// fallback path. Loop until the result is non-zero per W3C spec.
func randomTraceID() apitrace.TraceID {
	var tid apitrace.TraceID
	for {
		binary.NativeEndian.PutUint64(tid[:8], rand.Uint64())
		binary.NativeEndian.PutUint64(tid[8:], rand.Uint64())
		if tid.IsValid() {
			return tid
		}
	}
}

func randomSpanID() apitrace.SpanID {
	var sid apitrace.SpanID
	for {
		binary.NativeEndian.PutUint64(sid[:], rand.Uint64())
		if sid.IsValid() {
			return sid
		}
	}
}

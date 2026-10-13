package scenario

import (
	"crypto/rand"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

// SpanCollectionErrorName names the span that tells the judge why remote
// spans are missing.
const SpanCollectionErrorName = "langwatch.span_collection.error"

// NewSyntheticErrorSpan returns an ended span describing a span collection
// failure in traceID, so the judge's trace digest can tell "no spans" from
// "collecting spans failed". The span is tagged with threadID.
func NewSyntheticErrorSpan(traceID trace.TraceID, threadID, reason string) sdktrace.ReadOnlySpan {
	var spanID trace.SpanID
	_, _ = rand.Read(spanID[:])
	now := time.Now()
	stub := tracetest.SpanStub{
		Name: SpanCollectionErrorName,
		SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
			TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled,
		}),
		SpanKind:  trace.SpanKindInternal,
		StartTime: now,
		EndTime:   now,
		Status:    sdktrace.Status{Code: codes.Error, Description: reason},
		Attributes: []attribute.KeyValue{
			attribute.Bool("langwatch.span_collection.error", true),
			attribute.String("langwatch.span_collection.error.reason", reason),
			attribute.String(threadIDKey, threadID),
		},
		InstrumentationScope: instrumentation.Scope{Name: "langwatch.scenario"},
	}
	return stub.Snapshot()
}

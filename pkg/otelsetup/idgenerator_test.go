package otelsetup

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

/** @scenario Studio playground request with body trace_id but no traceparent header creates a true root span */
func TestContextAwareIDGenerator_HonorsOverrideForRootSpans(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(rec),
		sdktrace.WithIDGenerator(NewIDGenerator()),
	)
	tracer := tp.Tracer("test")

	want := trace.TraceID{
		0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
		0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
	}

	ctx := WithTraceIDOverride(context.Background(), want)
	_, span := tracer.Start(ctx, "studio-root")
	span.End()

	ended := rec.Ended()
	require.Len(t, ended, 1)

	// Trace-id continuity preserved.
	assert.Equal(t, want, ended[0].SpanContext().TraceID(),
		"override-supplied trace_id must be used for the new root span")

	// And — the load-bearing assertion for the 2026-05-15 fix — the
	// span has NO parent. Pre-fix the studio root carried a phantom
	// parent_span_id minted by tracing.go, which surfaced in the UI
	// as "Parent not in trace".
	assert.False(t, ended[0].Parent().IsValid(),
		"with no inbound parent SpanContext the root span must have an invalid parent — got %v",
		ended[0].Parent().SpanID())
}

/** @scenario Context-aware IDGenerator only affects spans started without a valid parent */
func TestContextAwareIDGenerator_DoesNotOverrideChildSpans(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(rec),
		sdktrace.WithIDGenerator(NewIDGenerator()),
	)
	tracer := tp.Tracer("test")

	parentTraceID := trace.TraceID{
		0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
		0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
	}
	overrideTraceID := trace.TraceID{
		0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
		0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
	}

	// Build a context with both a valid parent SpanContext AND an
	// override. OTel only consults IDGenerator.NewIDs when there is no
	// valid parent — the override must be ignored here.
	parentSC := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    parentTraceID,
		SpanID:     trace.SpanID{1, 2, 3, 4, 5, 6, 7, 8},
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), parentSC)
	ctx = WithTraceIDOverride(ctx, overrideTraceID)

	_, span := tracer.Start(ctx, "child-span")
	span.End()

	ended := rec.Ended()
	require.Len(t, ended, 1)
	assert.Equal(t, parentTraceID, ended[0].SpanContext().TraceID(),
		"child span must inherit parent trace_id even when an override is in context")
	assert.True(t, ended[0].Parent().IsValid(),
		"child span must report a valid parent")
}

func TestWithTraceIDOverride_InvalidTraceIDIsDropped(t *testing.T) {
	// Zero TraceID is invalid per W3C and would corrupt traces if
	// honored. WithTraceIDOverride must silently drop it so callers
	// can't accidentally pin to all-zeros.
	ctx := WithTraceIDOverride(context.Background(), trace.TraceID{})
	_, ok := traceIDFromContext(ctx)
	assert.False(t, ok, "WithTraceIDOverride must reject the zero TraceID")
}

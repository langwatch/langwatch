package customertracebridge

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/trace"
)

func TestWithTraceParent_roundtrips(t *testing.T) {
	tp := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	ctx := WithTraceParent(context.Background(), tp)
	assert.Equal(t, tp, TraceParent(ctx))
}

func TestWithTraceParent_empty_returns_original_context(t *testing.T) {
	ctx := context.Background()
	got := WithTraceParent(ctx, "")
	assert.Empty(t, TraceParent(got))
}

func TestTraceParent_missing_returns_empty(t *testing.T) {
	assert.Empty(t, TraceParent(context.Background()))
}

// CustomerTraceID names the trace the customer sees, which is what anything
// pointing back at a request from outside the request has to join on.
func TestCustomerTraceID(t *testing.T) {
	t.Run("empty when no customer span is open", func(t *testing.T) {
		// An all-zeros id would look like a join key and match every other
		// unrecorded request.
		assert.Empty(t, CustomerTraceID(context.Background()))
	})

	t.Run("reads the customer span, not the ambient one", func(t *testing.T) {
		customer := mustSpanContext(t, "4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7")
		ambient := mustSpanContext(t, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb")

		ctx := trace.ContextWithSpanContext(context.Background(), ambient)
		ctx = withActiveSpan(ctx, noopSpanWith(customer))

		// The two are different traces whenever the caller sent no
		// traceparent of its own, and only one of them reaches the project.
		assert.Equal(t, "4bf92f3577b34da6a3ce929d0e0e4736", CustomerTraceID(ctx))
	})
}

func mustSpanContext(t *testing.T, traceID, spanID string) trace.SpanContext {
	t.Helper()
	tid, err := trace.TraceIDFromHex(traceID)
	require.NoError(t, err)
	sid, err := trace.SpanIDFromHex(spanID)
	require.NoError(t, err)
	return trace.NewSpanContext(trace.SpanContextConfig{TraceID: tid, SpanID: sid})
}

func noopSpanWith(sc trace.SpanContext) trace.Span {
	return trace.SpanFromContext(trace.ContextWithSpanContext(context.Background(), sc))
}

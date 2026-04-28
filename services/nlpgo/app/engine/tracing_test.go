package engine

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// withRecorder swaps in a sdktrace TracerProvider with a SpanRecorder
// for the duration of the test, restoring the previous provider on
// cleanup. Tests assert against the recorder's captured spans.
func withRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	prev := otelapi.GetTracerProvider()
	otelapi.SetTracerProvider(tp)
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		otelapi.SetTracerProvider(prev)
	})
	return rec
}

// TestStartNodeSpan_NameAndAttributes pins the span shape downstream
// trace explorers depend on: the name slug encodes the node type so
// filtering by "all code-block runs" works, and the langwatch.* attrs
// give per-tenant + per-trace correlation without any join.
func TestStartNodeSpan_NameAndAttributes(t *testing.T) {
	rec := withRecorder(t)

	node := &dsl.Node{ID: "code-1", Type: dsl.ComponentCode}
	req := ExecuteRequest{
		ProjectID: "proj_abc",
		TraceID:   "trace_xyz",
		ThreadID:  "thread_qq",
		Origin:    "workflow",
	}
	_, span := startNodeSpan(context.Background(), node, req)
	endNodeSpan(span, &NodeState{DurationMS: 42, Cost: 0.001}, nil)

	spans := rec.Ended()
	require.Len(t, spans, 1)
	got := spans[0]
	assert.Equal(t, "nlpgo.node.code", got.Name())
	attrs := attrMap(got.Attributes())
	assert.Equal(t, "code-1", attrs["langwatch.node_id"])
	assert.Equal(t, "code", attrs["langwatch.node_type"])
	assert.Equal(t, "proj_abc", attrs["langwatch.project_id"])
	assert.Equal(t, "trace_xyz", attrs["langwatch.trace_id"])
	assert.Equal(t, "thread_qq", attrs["langwatch.thread_id"])
	assert.Equal(t, "workflow", attrs["langwatch.origin"])
	assert.Equal(t, int64(42), attrs["langwatch.duration_ms"])
	assert.Equal(t, 0.001, attrs["langwatch.cost"])
	assert.Equal(t, codes.Ok, got.Status().Code)
}

// TestEndNodeSpan_RecordsErrorOnDispatchFailure: when dispatch returns
// a NodeError, the span carries error.type / error.message and a
// codes.Error status so trace-search by failure class works.
func TestEndNodeSpan_RecordsErrorOnDispatchFailure(t *testing.T) {
	rec := withRecorder(t)

	node := &dsl.Node{ID: "code-1", Type: dsl.ComponentCode}
	_, span := startNodeSpan(context.Background(), node, ExecuteRequest{})
	endNodeSpan(span, &NodeState{DurationMS: 5},
		&NodeError{Type: "code_runner_error", Message: "boom"},
	)

	spans := rec.Ended()
	require.Len(t, spans, 1)
	got := spans[0]
	assert.Equal(t, codes.Error, got.Status().Code)
	assert.Equal(t, "boom", got.Status().Description)
	attrs := attrMap(got.Attributes())
	assert.Equal(t, "code_runner_error", attrs["error.type"])
	assert.Equal(t, "boom", attrs["error.message"])
}

// TestStartNodeSpan_NoOptionalAttrsWhenAbsent keeps the spans tight —
// trace storage isn't free, and stamping empty-string attributes
// pollutes filter dropdowns in trace UIs. Only the always-present
// fields land when the request has no project/trace/etc.
func TestStartNodeSpan_NoOptionalAttrsWhenAbsent(t *testing.T) {
	rec := withRecorder(t)

	node := &dsl.Node{ID: "x", Type: dsl.ComponentSignature}
	_, span := startNodeSpan(context.Background(), node, ExecuteRequest{})
	endNodeSpan(span, nil, nil)

	spans := rec.Ended()
	require.Len(t, spans, 1)
	attrs := attrMap(spans[0].Attributes())
	assert.Contains(t, attrs, "langwatch.node_id")
	assert.Contains(t, attrs, "langwatch.node_type")
	assert.NotContains(t, attrs, "langwatch.project_id")
	assert.NotContains(t, attrs, "langwatch.trace_id")
	assert.NotContains(t, attrs, "langwatch.thread_id")
	assert.NotContains(t, attrs, "langwatch.origin")
	assert.NotContains(t, attrs, "langwatch.duration_ms")
	assert.NotContains(t, attrs, "langwatch.cost")
}

func attrMap(kvs []attribute.KeyValue) map[string]any {
	out := make(map[string]any, len(kvs))
	for _, kv := range kvs {
		out[string(kv.Key)] = kv.Value.AsInterface()
	}
	return out
}

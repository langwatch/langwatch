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

// TestStartNodeSpan_NameIsUserSetNodeName pins the span name to the
// user-set node.Data.Name (with node.ID fallback). Earlier revisions
// hard-coded "execute_component" for every node, which surfaced N
// identical "execute_component" spans in the Studio drawer for an
// N-node workflow (rchaves dogfood 2026-05-14). Python's DSPy
// autotracking names spans by the generated wrapper-module class
// name (e.g. "v1" for an LLM Call named v1) — we mirror that by
// reading node.Data.Name.
func TestStartNodeSpan_NameIsUserSetNodeName(t *testing.T) {
	rec := withRecorder(t)

	nodeName := "Classify the question"
	node := &dsl.Node{ID: "code-1", Type: dsl.ComponentCode, Data: dsl.Component{Name: &nodeName}}
	req := ExecuteRequest{
		ProjectID: "proj_abc",
		TraceID:   "trace_xyz",
		ThreadID:  "thread_qq",
		Origin:    "workflow",
	}
	_, span := startNodeSpan(context.Background(), node, req)
	endNodeSpan(span, &NodeState{
		Inputs:     map[string]any{"a": 1, "b": 2},
		Outputs:    map[string]any{"sum": 3},
		DurationMS: 42,
		Cost:       0.001,
	}, nil)

	spans := rec.Ended()
	require.Len(t, spans, 1)
	got := spans[0]
	assert.Equal(t, "Classify the question", got.Name())
	attrs := attrMap(got.Attributes())
	assert.Equal(t, "component", attrs["langwatch.span.type"])
	assert.Equal(t, "code-1", attrs["langwatch.node_id"])
	assert.Equal(t, "code", attrs["langwatch.node_type"])
	assert.Equal(t, "proj_abc", attrs["langwatch.project_id"])
	assert.Equal(t, "trace_xyz", attrs["langwatch.trace_id"])
	assert.Equal(t, "thread_qq", attrs["langwatch.thread_id"])
	assert.Equal(t, "workflow", attrs["langwatch.origin"])
	assert.Equal(t, int64(42), attrs["langwatch.duration_ms"])
	assert.InDelta(t, 0.001, attrs["langwatch.cost"], 1e-9)
	assert.Equal(t, codes.Ok, got.Status().Code)
}

// TestNodeSpanName_FallsBackToNodeID covers the unnamed-node case —
// when node.Data.Name is nil/empty, the span name uses node.ID so the
// Studio drawer still shows a stable identifier.
func TestNodeSpanName_FallsBackToNodeID(t *testing.T) {
	node := &dsl.Node{ID: "auto-generated-id-abc123", Type: dsl.ComponentCode}
	assert.Equal(t, "auto-generated-id-abc123", nodeSpanName(node))

	empty := ""
	node.Data.Name = &empty
	assert.Equal(t, "auto-generated-id-abc123", nodeSpanName(node))
}

// TestNodeEmitsSpan_EntryAndEndAreSuppressed pins the pass-through-
// suppression contract: Entry/End nodes don't emit spans because the
// Python workflow.py.jinja template doesn't decorate those wrapper
// classes with @langwatch.span — and a 3-node workflow showing 3
// "execute_component" spans (entry/middle/end) confused operators
// who saw 3× the dispatch count they expected (rchaves dogfood
// 2026-05-14).
func TestNodeEmitsSpan_EntryAndEndAreSuppressed(t *testing.T) {
	assert.False(t, nodeEmitsSpan(dsl.ComponentEntry), "entry is a pass-through, no span")
	assert.False(t, nodeEmitsSpan(dsl.ComponentEnd), "end is a pass-through, no span")
	assert.False(t, nodeEmitsSpan(dsl.ComponentPromptingTechnique), "prompting technique is a no-op decorator, no span")
	assert.True(t, nodeEmitsSpan(dsl.ComponentSignature))
	assert.True(t, nodeEmitsSpan(dsl.ComponentCode))
	assert.True(t, nodeEmitsSpan(dsl.ComponentHTTP))
	assert.True(t, nodeEmitsSpan(dsl.ComponentEvaluator))
}

// TestEndNodeSpan_StampsLangwatchInputAndOutput is the M2 contract:
// langwatch.input / langwatch.output are JSON strings of the actual
// inputs/outputs map. Without these, Studio's Trace Details drawer
// reports output_source = "inferred" and falls back to scraping the
// response body — which on the new nlpgo path produces a near-empty
// blob (the prod regression rchaves caught on 2026-04-28).
func TestEndNodeSpan_StampsLangwatchInputAndOutput(t *testing.T) {
	rec := withRecorder(t)

	node := &dsl.Node{ID: "code-1", Type: dsl.ComponentCode}
	_, span := startNodeSpan(context.Background(), node, ExecuteRequest{})
	endNodeSpan(span, &NodeState{
		Inputs:  map[string]any{"input": "hi1"},
		Outputs: map[string]any{"output": "Hello world! hi1"},
	}, nil)

	spans := rec.Ended()
	require.Len(t, spans, 1)
	attrs := attrMap(spans[0].Attributes())
	assert.JSONEq(t, `{"input":"hi1"}`, attrs["langwatch.input"].(string))
	assert.JSONEq(t, `{"output":"Hello world! hi1"}`, attrs["langwatch.output"].(string))
}

// TestEndNodeSpan_RecordsErrorOnDispatchFailure: when dispatch returns
// a NodeError, the span carries error.type / error.message and a
// codes.Error status so trace-search by failure class works. The
// langwatch.input attribute is still stamped (debugging the failure
// needs to know what went in); langwatch.output is intentionally
// omitted because it would be misleading.
func TestEndNodeSpan_RecordsErrorOnDispatchFailure(t *testing.T) {
	rec := withRecorder(t)

	node := &dsl.Node{ID: "code-1", Type: dsl.ComponentCode}
	_, span := startNodeSpan(context.Background(), node, ExecuteRequest{})
	endNodeSpan(span, &NodeState{
		Inputs:     map[string]any{"input": "boom"},
		DurationMS: 5,
	}, &NodeError{Type: "code_runner_error", Message: "boom"})

	spans := rec.Ended()
	require.Len(t, spans, 1)
	got := spans[0]
	assert.Equal(t, codes.Error, got.Status().Code)
	assert.Equal(t, "boom", got.Status().Description)
	attrs := attrMap(got.Attributes())
	assert.Equal(t, "code_runner_error", attrs["error.type"])
	assert.Equal(t, "boom", attrs["error.message"])
	assert.JSONEq(t, `{"input":"boom"}`, attrs["langwatch.input"].(string))
	assert.NotContains(t, attrs, "langwatch.output")
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
	assert.Contains(t, attrs, "langwatch.span.type")
	assert.Contains(t, attrs, "langwatch.node_id")
	assert.Contains(t, attrs, "langwatch.node_type")
	assert.NotContains(t, attrs, "langwatch.project_id")
	assert.NotContains(t, attrs, "langwatch.trace_id")
	assert.NotContains(t, attrs, "langwatch.thread_id")
	assert.NotContains(t, attrs, "langwatch.origin")
	assert.NotContains(t, attrs, "langwatch.duration_ms")
	assert.NotContains(t, attrs, "langwatch.cost")
	assert.NotContains(t, attrs, "langwatch.input")
	assert.NotContains(t, attrs, "langwatch.output")
}

// TestEndNodeSpan_PreservesFullJSON_NoTruncation pins the no-truncation
// contract: agent outputs can be huge (full document corpora, multi-MB
// JSON dumps) and operators want the full content in Studio. Python
// SDK default truncated at 5000 chars/string; we deliberately do not
// truncate so big agent outputs survive end-to-end. Downstream limits
// (OTLP exporter body size, ClickHouse storage) cap if needed; not our
// concern at the helper layer.
func TestEndNodeSpan_PreservesFullJSON_NoTruncation(t *testing.T) {
	rec := withRecorder(t)

	const huge = 200 * 1024 // 200 KB string — would be truncated under any reasonable cap
	bigStr := make([]byte, huge)
	for i := range bigStr {
		bigStr[i] = 'x'
	}
	node := &dsl.Node{ID: "n", Type: dsl.ComponentCode}
	_, span := startNodeSpan(context.Background(), node, ExecuteRequest{})
	endNodeSpan(span, &NodeState{
		Inputs:  map[string]any{"big": string(bigStr)},
		Outputs: map[string]any{"big": string(bigStr)},
	}, nil)

	spans := rec.Ended()
	require.Len(t, spans, 1)
	attrs := attrMap(spans[0].Attributes())
	in := attrs["langwatch.input"].(string)
	out := attrs["langwatch.output"].(string)
	assert.NotContains(t, in, "truncated")
	assert.NotContains(t, out, "truncated")
	// Round-trips through json.Marshal so the value is wrapped in a
	// {"big":"xxxx...xxxx"} object — the JSON serialization of a 200KB
	// string is ~200KB + ~10 bytes overhead.
	assert.Greater(t, len(in), huge, "full input must be preserved, no truncation")
	assert.Greater(t, len(out), huge, "full output must be preserved, no truncation")
}

func attrMap(kvs []attribute.KeyValue) map[string]any {
	out := make(map[string]any, len(kvs))
	for _, kv := range kvs {
		out[string(kv.Key)] = kv.Value.AsInterface()
	}
	return out
}

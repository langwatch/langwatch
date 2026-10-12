package engine

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestEngineExecute_SuppressesEntryAndEndSpans is the end-to-end
// suppression proof: a workflow whose only nodes are pass-throughs
// (Entry + End) must produce ZERO engine-emitted spans. Mirrors
// Python's workflow.py.jinja generated wrapper classes for Entry/End
// types which lack the `@langwatch.span` decorator. The pre-fix 3-
// span output for a 3-node workflow confused operators who saw 3×
// the dispatch count they expected (rchaves dogfood 2026-05-14).
func TestEngineExecute_SuppressesEntryAndEndSpans(t *testing.T) {
	rec := withRecorder(t)

	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "tracing_parity_e2e",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "end", TargetHandle: "inputs.output"},
		},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow:  wf,
		Inputs:    map[string]any{"input": "hello"},
		Origin:    "workflow",
		ProjectID: "proj_e2e",
		TraceID:   "trace_e2e",
	})
	require.NoError(t, err)
	require.Equal(t, "success", res.Status)

	spans := rec.Ended()
	require.Empty(t, spans,
		"Entry + End are pass-throughs and must NOT emit per-node spans (Python parity)")
}

// TestEngineExecute_ErrorPathStampsInputNotOutput pins the contract
// in tracing-parity.feature for the error path: when a node fails,
// the span captures what it received (debugging) but not a fake
// output (would mislead the operator into thinking the value was
// returned successfully).
func TestEngineExecute_ErrorPathStampsInputNotOutput(t *testing.T) {
	rec := withRecorder(t)

	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "tracing_parity_error",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			// A code node with no Code executor wired triggers the
			// "code executor not configured" branch in dispatch — a
			// deterministic failure path that doesn't need Python.
			{ID: "code-1", Type: dsl.ComponentCode},
			// End node required by the missing-End planner guard (#3198);
			// code-1 errors before End runs, so the error-path assertions
			// below are unaffected.
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "code-1", TargetHandle: "inputs.input"},
			{Source: "code-1", Target: "end"},
		},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: wf,
		Inputs:   map[string]any{"input": "boom"},
	})
	require.NoError(t, err)
	require.Equal(t, "error", res.Status)

	spans := rec.Ended()
	require.NotEmpty(t, spans)

	var failed map[string]any
	for _, s := range spans {
		attrs := attrMap(s.Attributes())
		if attrs["langwatch.node_id"] == "code-1" {
			failed = attrs
			break
		}
	}
	require.NotNil(t, failed, "code-1 node must have a span")
	assert.Contains(t, failed, "langwatch.input",
		"failed node still stamps input — operator needs to see what went in")
	assert.NotContains(t, failed, "langwatch.output",
		"failed node must NOT stamp output (would be misleading)")
	assert.Contains(t, failed, "error.type")
	assert.Contains(t, failed, "error.message")
}

package engine

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestEngineExecute_EmitsExecuteComponentSpansWithJSONIO is the
// end-to-end proof that Engine.Execute (not just the helpers) produces
// the Python-parity span shape Studio's Trace Details drawer renders.
// Pre-fix shipped on 2026-04-28 had a single empty `nlpgo.node.end`
// span and `output_source: inferred`; this test asserts the fix.
//
// Workflow: entry → end. Both nodes get an execute_component span;
// each span carries langwatch.input + langwatch.output as JSON
// strings so Studio shows the actual values instead of falling back
// to inferred output.
func TestEngineExecute_EmitsExecuteComponentSpansWithJSONIO(t *testing.T) {
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
	require.NotEmpty(t, spans, "engine must emit at least one span")

	byNodeID := map[string]map[string]any{}
	for _, s := range spans {
		require.Equal(t, "execute_component", s.Name(),
			"all engine-emitted spans must share the Python-parity name 'execute_component'")
		attrs := attrMap(s.Attributes())
		require.Equal(t, "component", attrs["langwatch.span.type"],
			"span.type must be 'component' to match Python's optional_langwatch_trace(type='component')")
		require.Equal(t, "proj_e2e", attrs["langwatch.project_id"])
		require.Equal(t, "trace_e2e", attrs["langwatch.trace_id"])
		require.Equal(t, "workflow", attrs["langwatch.origin"])
		nodeID, _ := attrs["langwatch.node_id"].(string)
		byNodeID[nodeID] = attrs
	}

	endAttrs, ok := byNodeID["end"]
	require.True(t, ok, "end node must have its own execute_component span")
	// langwatch.input on the end node is the resolved input map (the
	// upstream entry's output flowing through the edge). Studio uses
	// this exact attribute to render the "INPUT" panel of the trace
	// drawer; without it, output_source falls back to "inferred" and
	// the panel goes blank — the regression rchaves caught.
	inJSON, ok := endAttrs["langwatch.input"].(string)
	require.True(t, ok, "end node span must stamp langwatch.input")
	var in map[string]any
	require.NoError(t, json.Unmarshal([]byte(inJSON), &in))
	assert.Equal(t, "hello", in["output"], "end node received entry's output via edge")

	// langwatch.output on the end node is the same map (end is a
	// passthrough). Studio renders this in the "OUTPUT" panel.
	outJSON, ok := endAttrs["langwatch.output"].(string)
	require.True(t, ok, "end node span must stamp langwatch.output")
	var out map[string]any
	require.NoError(t, json.Unmarshal([]byte(outJSON), &out))
	assert.Equal(t, "hello", out["output"])
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
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "code-1", TargetHandle: "inputs.input"},
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

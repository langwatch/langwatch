package engine

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestEngineExecute_NodeIDDispatchesOnlyTargetNode pins the
// execute_component contract: when ExecuteRequest.NodeID is set,
// the engine dispatches ONLY that one node — never the rest of the
// DAG.
//
// Pre-fix shipped on 2026-04-29 walked plan.Layers regardless of
// req.NodeID, so a single-component "Run with manual input" click on
// the Code card surfaced spurious entry/end/sibling spans in the
// trace and (worse) ran the evaluator node — which then errored with
// "LangWatchBaseURL is required to call the evaluator API" because
// the user hadn't asked for evaluator dispatch in the first place.
//
// Mirrors langwatch_nlp/studio/execute/execute_component.py which
// instantiates and invokes one materialized component, never the DAG.
func TestEngineExecute_NodeIDDispatchesOnlyTargetNode(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "execute_component_scope",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code-1", Type: dsl.ComponentCode},
			{ID: "evaluator-1", Type: dsl.ComponentEvaluator},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "code-1", TargetHandle: "inputs.input"},
			{Source: "code-1", SourceHandle: "outputs.output", Target: "evaluator-1", TargetHandle: "inputs.input"},
			{Source: "evaluator-1", SourceHandle: "outputs.passed", Target: "end", TargetHandle: "inputs.passed"},
		},
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: wf,
		// Studio execute_component target — only this node should
		// dispatch. Inputs are the user-typed manual values for the
		// target node (per ExecuteRequest.NodeID docs).
		NodeID: "code-1",
		Inputs: map[string]any{"input": "hi"},
	})
	require.NoError(t, err)

	// Only the requested node has a recorded NodeState. Sibling nodes
	// (entry, evaluator-1, end) were not dispatched, so their
	// NodeStates are absent. If the pre-fix behavior regresses and the
	// engine walks plan.Layers, we'd see all four nodes here — this
	// test catches that.
	require.Len(t, res.Nodes, 1, "execute_component must dispatch only the target node, not the full DAG")
	require.Contains(t, res.Nodes, "code-1")
	for _, sibling := range []string{"entry", "evaluator-1", "end"} {
		assert.NotContains(t, res.Nodes, sibling,
			"sibling node %q must NOT be dispatched on execute_component (Python parity: only the target node runs)", sibling)
	}
}

// TestEngineExecute_NodeIDNotInWorkflowReturnsError pins the loud-fail
// contract: an execute_component request naming a non-existent node
// must return an error synchronously, not silently no-op.
func TestEngineExecute_NodeIDNotInWorkflowReturnsError(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "missing_target",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code-1", Type: dsl.ComponentCode},
		},
	}

	_, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: wf,
		NodeID:   "does-not-exist",
		Inputs:   map[string]any{"input": "hi"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "execute_component target node")
	assert.Contains(t, err.Error(), "does-not-exist")
}

// TestExecuteStream_NodeIDDispatchesOnlyTargetNode is the streaming
// counterpart — Studio's SSE execute path also uses NodeID for
// per-component runs.
func TestExecuteStream_NodeIDDispatchesOnlyTargetNode(t *testing.T) {
	eng := New(Options{})
	wf := &dsl.Workflow{
		WorkflowID: "execute_component_scope_stream",
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code-1", Type: dsl.ComponentCode},
			{ID: "evaluator-1", Type: dsl.ComponentEvaluator},
			{ID: "end", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.input", Target: "code-1", TargetHandle: "inputs.input"},
			{Source: "code-1", SourceHandle: "outputs.output", Target: "evaluator-1", TargetHandle: "inputs.input"},
		},
	}

	ch, err := eng.ExecuteStream(context.Background(), ExecuteRequest{
		Workflow: wf,
		NodeID:   "code-1",
		Inputs:   map[string]any{"input": "hi"},
	}, ExecuteStreamOptions{})
	require.NoError(t, err)

	// Collect every component_state_change event and assert no sibling
	// shows up. The pre-fix loop fired one running + one finished event
	// per node-in-layer, so siblings would surface here.
	dispatchedNodes := map[string]bool{}
	for ev := range ch {
		if ev.Type != "component_state_change" {
			continue
		}
		if id, ok := ev.Payload["component_id"].(string); ok {
			dispatchedNodes[id] = true
		}
	}
	require.Len(t, dispatchedNodes, 1, "execute_component must emit state events for ONLY the target node")
	assert.True(t, dispatchedNodes["code-1"])
	for _, sibling := range []string{"entry", "evaluator-1", "end"} {
		assert.False(t, dispatchedNodes[sibling], "sibling %q must not emit component_state_change", sibling)
	}
}

package engine

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// Manual-inputs override pins the Studio "Run with manual input" flow
// (execute_component): when the user types into a node's input panel
// and clicks Execute, those values must reach THAT node directly,
// regardless of how the workflow's edges are wired (or whether they
// exist at all).
//
// Pre-fix behavior: resolveInputs always walked inbound edges, and
// req.Inputs was treated as Entry-node outputs. A fresh-dragged Code
// node with no Entry→Code wiring received an empty input map → the
// Python runner raised
//   `Code.__call__() missing 1 required positional argument: 'input'`
// and the Studio input field appeared to be silently dropped on
// Execute click.
//
// Mirrors langwatch_nlp/studio/app.py's `payload.node_id` plumbing:
// when node_id is set, the inputs are the target's manual values, not
// the Entry's outputs. See ExecuteRequest.NodeID for the contract.
func TestResolveInputs_ManualInputsForTargetNode(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "code-1", Type: dsl.ComponentCode},
		},
	}
	state := newRunState(wf)
	state.manualInputsTarget = "code-1"
	state.manualInputs = map[string]any{"input": "asdf", "extra": 42}

	got := state.resolveInputs(nil, "code-1")

	assert.Equal(t, map[string]any{"input": "asdf", "extra": 42}, got)
}

// Other nodes in the workflow keep their normal edge-based resolution
// even when a manualInputsTarget is set. Multi-node Studio runs would
// break if every node received the manual inputs — only the explicit
// target should.
func TestResolveInputs_ManualInputsScopedToTarget(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "code-1", Type: dsl.ComponentCode},
			{ID: "code-2", Type: dsl.ComponentCode},
		},
	}
	state := newRunState(wf)
	state.manualInputsTarget = "code-1"
	state.manualInputs = map[string]any{"input": "for-code-1"}

	other := state.resolveInputs(nil, "code-2")

	assert.Empty(t, other, "non-target nodes must not receive manual inputs")
}

// Regression guard for caller-side mutation: the returned map must be
// a copy, not a shared reference into runState. Otherwise a downstream
// node executor that mutates its inputs (rare but legal) would
// silently corrupt the original manualInputs and break a re-resolution
// later in the same run.
func TestResolveInputs_ManualInputsReturnsCopy(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "code-1", Type: dsl.ComponentCode},
		},
	}
	state := newRunState(wf)
	original := map[string]any{"input": "asdf"}
	state.manualInputsTarget = "code-1"
	state.manualInputs = original

	got := state.resolveInputs(nil, "code-1")
	got["input"] = "mutated"
	got["new_key"] = "added"

	assert.Equal(t, "asdf", original["input"], "mutation of returned map must not affect runState.manualInputs")
	_, exists := original["new_key"]
	assert.False(t, exists, "additions to returned map must not leak into runState.manualInputs")
}

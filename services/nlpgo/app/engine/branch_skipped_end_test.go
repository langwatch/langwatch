package engine

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// The runtime twin of the two planner guards, and the one shape neither of
// them can see: a workflow whose only End node sits behind an if/else branch
// that is not taken. The graph is valid — the End IS reachable from Entry, so
// the plan includes it — and it is only at execution time that branch gating
// skips it and the run produces nothing.
//
// This is a deliberate behavior change and the reason it is called out under
// Deployment Impact on the PR: before #3198 such a run returned
// `{status:"success", result:{}}`. It now errors. The call: a run that
// produces no result is exactly #3198's symptom whatever the cause, and on the
// surface the issue was filed against — a workflow used as a scenario agent —
// an empty result IS the bug (a blank agent turn with nothing to act on).
// The message points at the real remedy for this shape, "reachable on every
// branch", rather than at wiring.
//
// Pinned here because it was previously an unstated side effect: every
// pre-existing if/else test wires both branches into one End node, which is
// never skipped, so nothing in the suite could observe it.

// endBehindUntakenBranchWorkflow: entry -> gate -(true)-> end. The condition is
// false, so `end` never runs.
func endBehindUntakenBranchWorkflow(t *testing.T) *dsl.Workflow {
	t.Helper()
	return &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				Outputs: []dsl.Field{{Identifier: "amount", Type: "float"}},
				Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{Records: map[string][]any{"amount": {1}}}},
			}},
			{ID: "gate", Type: dsl.ComponentIfElse, Data: dsl.Component{
				Inputs:  []dsl.Field{{Identifier: "amount", Type: "float"}},
				Outputs: []dsl.Field{{Identifier: "true", Type: "bool"}, {Identifier: "false", Type: "bool"}},
				// 1 > 100 is false, so the `true` branch — and the only End
				// node hanging off it — is skipped. (Liquid conditions are
				// bare expressions; the engine wraps them in {% if %}.)
				Parameters: []dsl.Field{strParam("condition", "amount > 100")},
			}},
			{ID: "end", Type: dsl.ComponentEnd, Data: dsl.Component{
				Inputs: []dsl.Field{{Identifier: "result", Type: "bool"}},
			}},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "entry", SourceHandle: "outputs.amount", Target: "gate", TargetHandle: "inputs.amount"},
			{ID: "e2", Source: "gate", SourceHandle: "outputs.true", Target: "end", TargetHandle: "inputs.result"},
		},
	}
}

// @scenario "A full run whose only End node is skipped by an untaken branch errors"
func TestExecute_EndBehindUntakenBranchErrorsRatherThanEmptySuccess(t *testing.T) {
	eng := New(Options{})

	res, err := eng.Execute(context.Background(), ExecuteRequest{
		Workflow: endBehindUntakenBranchWorkflow(t),
		TraceID:  "t",
	})
	require.NoError(t, err, "the graph is valid — both planner guards pass")

	require.Equal(t, "error", res.Status,
		"a run that produced no result must say so, not report an empty success (#3198)")
	require.NotNil(t, res.Error)
	assert.Equal(t, "unreached_end_node", res.Error.Type)
	assert.Equal(t, UnreachedEndNodeMessage, res.Error.Message)

	// The discriminator: this is NOT the planner rejecting the topology. The
	// gate really ran and really skipped the End — if it were a planner
	// error, Execute would have returned err and no node states at all.
	require.NotNil(t, res.Nodes["gate"], "the gate must have executed")
	assert.Equal(t, "success", res.Nodes["gate"].Status)
	assert.Equal(t, string(dsl.StatusSkipped), res.Nodes["end"].Status,
		"the End node must be skipped, not merely absent from the plan")
}

// The taken-branch control. Same workflow, a condition that holds — proving
// the guard above fires on the branch outcome and not on the shape, which an
// error-only test could not distinguish.
//
// @scenario "A run whose condition reaches its End node still succeeds"
func TestExecute_EndBehindTakenBranchStillSucceeds(t *testing.T) {
	eng := New(Options{})
	w := endBehindUntakenBranchWorkflow(t)
	for i := range w.Nodes {
		if w.Nodes[i].ID == "gate" {
			w.Nodes[i].Data.Parameters = []dsl.Field{strParam("condition", "amount > 0")}
		}
	}

	res, err := eng.Execute(context.Background(), ExecuteRequest{Workflow: w, TraceID: "t"})
	require.NoError(t, err)

	require.Equal(t, "success", res.Status, "the branch was taken, so the End node ran")
	assert.Nil(t, res.Error)
	assert.Equal(t, "success", res.Nodes["end"].Status)
}

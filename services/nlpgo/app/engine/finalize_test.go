package engine

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/planner"
)

// TestFinalize_RequireEndWithNoEndNodeErrors pins the AC2 defensive guard
// (#3198): if a full run somehow reaches finalize without an End node
// (e.g. a future entrypoint that skips the planner), finalize must return
// an explicit missing_end_node error rather than a silent empty success.
//
// @scenario "A full run that gets past the checks with no End node still errors"
func TestFinalize_RequireEndWithNoEndNodeErrors(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code", Type: dsl.ComponentCode},
		},
	}
	state := newRunState(w)
	require.Empty(t, state.endNodeIDs, "fixture must have no End node")

	state.requireEnd = true

	res := finalize(state, "trace", time.Now(), nil)

	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "missing_end_node", res.Error.Type)
	assert.Equal(t, planner.MissingEndNodeMessage, res.Error.Message)
}

// TestFinalize_RequireEndFalseAllowsNoEndNode is the exempt twin: a
// partial run (requireEnd=false, e.g. execute_component / run-until-here)
// with no End node must finalize as success, not the missing_end_node error.
//
// @scenario "A partial run with no End node still succeeds"
func TestFinalize_RequireEndFalseAllowsNoEndNode(t *testing.T) {
	w := &dsl.Workflow{Nodes: []dsl.Node{{ID: "code", Type: dsl.ComponentCode}}}
	state := newRunState(w)

	state.requireEnd = false

	res := finalize(state, "trace", time.Now(), nil)

	require.Equal(t, "success", res.Status)
	assert.Nil(t, res.Error)
}

// TestFinalize_RequireEndWithEndNodeThatNeverRanErrors is the guard the
// presence-only check misses (#3198): the End node EXISTS, so the
// missing_end_node branch does not fire, but nothing was ever
// recorded against it — the node never entered the plan (unwired) or never
// executed. Pre-fix this fell through to `status: "success"` with an empty
// result, which is the exact symptom the issue was filed about.
//
// @scenario "A full run whose End node produced no output errors instead of succeeding"
func TestFinalize_RequireEndWithEndNodeThatNeverRanErrors(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "end", Type: dsl.ComponentEnd},
		},
	}
	state := newRunState(w)
	require.Equal(t, []string{"end"}, state.endNodeIDs, "fixture must have an End node")

	state.requireEnd = true

	res := finalize(state, "trace", time.Now(), nil)

	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "unreached_end_node", res.Error.Type)
	assert.Equal(t, UnreachedEndNodeMessage, res.Error.Message)
}

// TestFinalize_RequireEndFalseAllowsEndNodeThatNeverRan is the exempt twin
// of the guard above: a "run until here" plan stops before the End node by
// design, so an unrecorded End must not turn into an error.
func TestFinalize_RequireEndFalseAllowsEndNodeThatNeverRan(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "end", Type: dsl.ComponentEnd},
		},
	}
	state := newRunState(w)

	state.requireEnd = false

	res := finalize(state, "trace", time.Now(), nil)

	require.Equal(t, "success", res.Status)
	assert.Nil(t, res.Error)
}

// TestFinalize_UsesTheEndNodeThatActuallyProducedOutput covers the branching
// shape: two End nodes, and the one that ran is NOT the first in node order.
// End nodes are collected in node order, so keying the result off the first
// would report an empty success for a run that did produce a result.
//
// @scenario "A full run takes its result from an End node that did produce output"
func TestFinalize_UsesTheEndNodeThatActuallyProducedOutput(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "end_a", Type: dsl.ComponentEnd},
			{ID: "end_b", Type: dsl.ComponentEnd},
		},
	}
	state := newRunState(w)
	require.Equal(t, []string{"end_a", "end_b"}, state.endNodeIDs, "both End nodes are tracked, in node order")
	state.recordOutputs("end_b", map[string]any{"output": "from b"})

	state.requireEnd = true

	res := finalize(state, "trace", time.Now(), nil)

	require.Equal(t, "success", res.Status)
	assert.Nil(t, res.Error)
	assert.Equal(t, map[string]any{"output": "from b"}, res.Result)
}

// TestFinalize_EmptyEndOutputsIsStillASuccess pins the boundary: an End node
// that ran and legitimately produced an empty map is a success, not the
// unreached_end_node error. The guard keys off "was anything recorded",
// not "is the recorded map non-empty".
func TestFinalize_EmptyEndOutputsIsStillASuccess(t *testing.T) {
	w := &dsl.Workflow{Nodes: []dsl.Node{{ID: "end", Type: dsl.ComponentEnd}}}
	state := newRunState(w)
	state.recordOutputs("end", map[string]any{})

	state.requireEnd = true

	res := finalize(state, "trace", time.Now(), nil)

	require.Equal(t, "success", res.Status)
	assert.Nil(t, res.Error)
	assert.Equal(t, map[string]any{}, res.Result)
}

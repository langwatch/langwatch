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
func TestFinalize_RequireEndWithNoEndNodeErrors(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code", Type: dsl.ComponentCode},
		},
	}
	state := newRunState(w)
	require.Empty(t, state.endNodeID, "fixture must have no End node")

	res := finalize(state, "trace", time.Now(), nil, true)

	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "missing_end_node", res.Error.Type)
	assert.Equal(t, planner.MissingEndNodeMessage, res.Error.Message)
}

// TestFinalize_RequireEndFalseAllowsNoEndNode is the exempt twin: a
// partial run (requireEnd=false, e.g. execute_component / run-until-here)
// with no End node must finalize as success, not the missing_end_node error.
func TestFinalize_RequireEndFalseAllowsNoEndNode(t *testing.T) {
	w := &dsl.Workflow{Nodes: []dsl.Node{{ID: "code", Type: dsl.ComponentCode}}}
	state := newRunState(w)

	res := finalize(state, "trace", time.Now(), nil, false)

	require.Equal(t, "success", res.Status)
	assert.Nil(t, res.Error)
}

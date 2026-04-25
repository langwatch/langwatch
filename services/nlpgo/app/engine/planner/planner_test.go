package planner_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/planner"
)

// linearWorkflow makes a 4-node chain: A -> B -> C -> D.
func linearWorkflow() *dsl.Workflow {
	return &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "A", Type: dsl.ComponentEntry},
			{ID: "B", Type: dsl.ComponentCode},
			{ID: "C", Type: dsl.ComponentHTTP},
			{ID: "D", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "A", Target: "B"},
			{ID: "e2", Source: "B", Target: "C"},
			{ID: "e3", Source: "C", Target: "D"},
		},
	}
}

func TestPlan_LinearChain(t *testing.T) {
	p, err := planner.New(linearWorkflow())
	require.NoError(t, err)
	require.Len(t, p.Layers, 4)
	assert.Equal(t, [][]string{{"A"}, {"B"}, {"C"}, {"D"}}, p.Layers)
	assert.Equal(t, []string{"B"}, p.Children["A"])
	assert.Equal(t, []string{"A"}, p.Parents["B"])
}

func TestPlan_FanOutFanIn(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "Entry", Type: dsl.ComponentEntry},
			{ID: "L", Type: dsl.ComponentCode},
			{ID: "R", Type: dsl.ComponentHTTP},
			{ID: "Sum", Type: dsl.ComponentCode},
			{ID: "End", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "Entry", Target: "L"},
			{ID: "e2", Source: "Entry", Target: "R"},
			{ID: "e3", Source: "L", Target: "Sum"},
			{ID: "e4", Source: "R", Target: "Sum"},
			{ID: "e5", Source: "Sum", Target: "End"},
		},
	}
	p, err := planner.New(w)
	require.NoError(t, err)
	require.Len(t, p.Layers, 4)
	assert.Equal(t, []string{"Entry"}, p.Layers[0])
	// L and R run in parallel after Entry; ordering matches input order.
	assert.Equal(t, []string{"L", "R"}, p.Layers[1])
	assert.Equal(t, []string{"Sum"}, p.Layers[2])
	assert.Equal(t, []string{"End"}, p.Layers[3])
}

func TestPlan_DetectsCycle(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "A", Type: dsl.ComponentCode},
			{ID: "B", Type: dsl.ComponentCode},
			{ID: "C", Type: dsl.ComponentCode},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "A", Target: "B"},
			{ID: "e2", Source: "B", Target: "C"},
			{ID: "e3", Source: "C", Target: "A"},
		},
	}
	_, err := planner.New(w)
	require.Error(t, err)
	var cyc *planner.CycleError
	require.True(t, errors.As(err, &cyc))
	// Cycle includes all three nodes, with the entry node repeated at the end.
	assert.Contains(t, cyc.Cycle, "A")
	assert.Contains(t, cyc.Cycle, "B")
	assert.Contains(t, cyc.Cycle, "C")
}

func TestPlan_DetectsSelfLoop(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{{ID: "A", Type: dsl.ComponentCode}},
		Edges: []dsl.Edge{{ID: "e1", Source: "A", Target: "A"}},
	}
	_, err := planner.New(w)
	require.Error(t, err)
	var cyc *planner.CycleError
	require.True(t, errors.As(err, &cyc))
	assert.Equal(t, []string{"A", "A"}, cyc.Cycle)
}

func TestPlan_RejectsUnknownEdgeEndpoint(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{{ID: "A", Type: dsl.ComponentEntry}},
		Edges: []dsl.Edge{{ID: "e1", Source: "ghost", Target: "A"}},
	}
	_, err := planner.New(w)
	require.Error(t, err)
	var unk *planner.UnknownNodeError
	require.True(t, errors.As(err, &unk))
	assert.Equal(t, "ghost", unk.NodeID)
	assert.Equal(t, "e1", unk.Edge)
}

func TestPlan_RejectsDuplicateNodeID(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "A", Type: dsl.ComponentEntry},
			{ID: "A", Type: dsl.ComponentEnd},
		},
	}
	_, err := planner.New(w)
	require.Error(t, err)
	var dup *planner.DuplicateNodeError
	require.True(t, errors.As(err, &dup))
	assert.Equal(t, "A", dup.NodeID)
}

func TestPlan_RejectsUnsupportedNodeKind(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "Entry", Type: dsl.ComponentEntry},
			{ID: "Agent", Type: dsl.ComponentAgent},
		},
		Edges: []dsl.Edge{{ID: "e1", Source: "Entry", Target: "Agent"}},
	}
	_, err := planner.New(w)
	require.Error(t, err)
	var unsup *planner.UnsupportedNodeKindError
	require.True(t, errors.As(err, &unsup))
	assert.Equal(t, "Agent", unsup.NodeID)
	assert.Equal(t, dsl.ComponentAgent, unsup.Kind)
}

func TestPlan_StableLayerOrdering(t *testing.T) {
	// Three independent nodes should appear in their input order, not
	// in map-iteration order.
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "alpha", Type: dsl.ComponentCode},
			{ID: "beta", Type: dsl.ComponentCode},
			{ID: "gamma", Type: dsl.ComponentCode},
		},
	}
	p, err := planner.New(w)
	require.NoError(t, err)
	require.Len(t, p.Layers, 1)
	assert.Equal(t, []string{"alpha", "beta", "gamma"}, p.Layers[0])
}

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
	// "future_kind" is a fictitious type not yet supported; covers the
	// case where a workflow ships from the future of the DSL with a
	// node kind nlpgo hasn't grown an executor for. The planner must
	// reject so the TS app can fall back to the legacy Python path.
	const futureKind dsl.ComponentType = "future_kind_reserved_for_test"
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "Entry", Type: dsl.ComponentEntry},
			{ID: "Future", Type: futureKind},
		},
		Edges: []dsl.Edge{{ID: "e1", Source: "Entry", Target: "Future"}},
	}
	_, err := planner.New(w)
	require.Error(t, err)
	var unsup *planner.UnsupportedNodeKindError
	require.True(t, errors.As(err, &unsup))
	assert.Equal(t, "Future", unsup.NodeID)
	assert.Equal(t, futureKind, unsup.Kind)
}

func TestPlan_RejectsRetiredKindRetriever(t *testing.T) {
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "Entry", Type: dsl.ComponentEntry},
			{ID: "Retriever", Type: dsl.ComponentRetriever},
		},
		Edges: []dsl.Edge{{ID: "e1", Source: "Entry", Target: "Retriever"}},
	}
	_, err := planner.New(w)
	require.Error(t, err)
	var ret *planner.RetiredNodeKindError
	require.True(t, errors.As(err, &ret), "want RetiredNodeKindError, got %T: %v", err, err)
	assert.Equal(t, "Retriever", ret.NodeID)
	assert.Equal(t, dsl.ComponentRetriever, ret.Kind)
	assert.Contains(t, ret.Message, "retired")
}

func TestPlan_AcceptsCustomKind(t *testing.T) {
	// `custom` was previously listed retired; Studio actively persists
	// `type: "custom"` for saved sub-workflow drops (NodeSelectionPanel.tsx
	// line 168). The engine now dispatches these through runCustom →
	// agentblock.WorkflowRunner, mirroring Python's CustomNode.forward.
	// Planner must accept them so a workflow that contains a saved
	// sub-workflow node can still build a plan; rchaves dogfood
	// 2026-04-30 hit a saved-workflow eval that retired-rejected here
	// instead of dispatching.
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "Entry", Type: dsl.ComponentEntry},
			{ID: "Custom", Type: dsl.ComponentCustom},
			{ID: "End", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "Entry", Target: "Custom"},
			{ID: "e2", Source: "Custom", Target: "End"},
		},
	}
	plan, err := planner.New(w)
	require.NoError(t, err)
	assert.NotNil(t, plan)
}

func TestPlan_AcceptsAgentAndEvaluatorKinds(t *testing.T) {
	// Agent + evaluator were 501-rejected pre-iter-17; iter-18 wires them
	// into the engine. Planner must accept them so a workflow that mixes
	// signature + evaluator + agent runs end-to-end on the Go path.
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "Entry", Type: dsl.ComponentEntry},
			{ID: "Sig", Type: dsl.ComponentSignature},
			{ID: "Eval", Type: dsl.ComponentEvaluator},
			{ID: "Agent", Type: dsl.ComponentAgent},
			{ID: "End", Type: dsl.ComponentEnd},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "Entry", Target: "Sig"},
			{ID: "e2", Source: "Sig", Target: "Eval"},
			{ID: "e3", Source: "Eval", Target: "Agent"},
			{ID: "e4", Source: "Agent", Target: "End"},
		},
	}
	plan, err := planner.New(w)
	require.NoError(t, err)
	assert.NotNil(t, plan)
}

func TestPlan_RetiredTakesPriorityOverUnsupported(t *testing.T) {
	// A workflow with both a retired (retriever) and an unsupported
	// (future_kind) node should surface the more-actionable retired-kind
	// error first. Reasoning: retired = the customer must remove/replace
	// the node; unsupported = the customer waits for a future release.
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "Entry", Type: dsl.ComponentEntry},
			{ID: "Retriever", Type: dsl.ComponentRetriever},
			{ID: "Future", Type: dsl.ComponentType("future_kind_reserved_for_test")},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "Entry", Target: "Retriever"},
			{ID: "e2", Source: "Entry", Target: "Future"},
		},
	}
	_, err := planner.New(w)
	require.Error(t, err)
	var ret *planner.RetiredNodeKindError
	assert.True(t, errors.As(err, &ret), "expected retired error to win, got %T: %v", err, err)
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

// flattenLayers collapses Plan.Layers into a single set so tests can
// assert "which nodes ran" without caring about layer ordering.
func flattenLayers(layers [][]string) map[string]bool {
	out := map[string]bool{}
	for _, layer := range layers {
		for _, id := range layer {
			out[id] = true
		}
	}
	return out
}

// disconnectedWorkflow models the rchaves dogfood shape:
// Entry -> Code -> End on the main chain, plus an Orphan LLM node that
// sits on the canvas with NO incoming edges. Python skips Orphan via
// find_reachable_nodes; pre-fix the Go engine ran it because Kahn's
// algorithm treats Orphan's zero indegree as "ready" regardless of
// reachability.
func disconnectedWorkflow() *dsl.Workflow {
	return &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code", Type: dsl.ComponentCode},
			{ID: "end", Type: dsl.ComponentEnd},
			{ID: "orphan", Type: dsl.ComponentSignature},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "entry", Target: "code"},
			{ID: "e2", Source: "code", Target: "end"},
		},
	}
}

func TestPlan_ExcludesOrphanNodeOnFullRun(t *testing.T) {
	p, err := planner.New(disconnectedWorkflow())
	require.NoError(t, err)
	ids := flattenLayers(p.Layers)
	assert.True(t, ids["entry"], "entry must be planned")
	assert.True(t, ids["code"], "code must be planned")
	assert.True(t, ids["end"], "end must be planned")
	assert.False(t, ids["orphan"], "orphan signature with no incoming edges must not be planned (Python find_reachable_nodes parity)")
}

func TestPlan_ExcludesDisconnectedSubChain(t *testing.T) {
	// Two parallel chains, only one of which roots at Entry. The whole
	// floating chain (floatA -> floatB) must be skipped — neither node
	// is reachable forward from Entry.
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "code", Type: dsl.ComponentCode},
			{ID: "end", Type: dsl.ComponentEnd},
			{ID: "floatA", Type: dsl.ComponentSignature},
			{ID: "floatB", Type: dsl.ComponentCode},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "entry", Target: "code"},
			{ID: "e2", Source: "code", Target: "end"},
			{ID: "fe1", Source: "floatA", Target: "floatB"},
		},
	}
	p, err := planner.New(w)
	require.NoError(t, err)
	ids := flattenLayers(p.Layers)
	assert.True(t, ids["entry"] && ids["code"] && ids["end"], "main chain must be planned")
	assert.False(t, ids["floatA"], "floatA (disconnected root) must be skipped")
	assert.False(t, ids["floatB"], "floatB (child of disconnected root) must be skipped")
}

func TestPlan_WithUntilNode_TrimsDownstreamAndOrphans(t *testing.T) {
	// Entry -> A -> B -> C -> End, plus an orphan Signature. "Run until
	// B" must plan {entry, A, B} only: C and End are downstream of the
	// target, orphan is unreachable from Entry. Mirrors Python's
	// find_path_until_node behavior.
	w := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "A", Type: dsl.ComponentCode},
			{ID: "B", Type: dsl.ComponentSignature},
			{ID: "C", Type: dsl.ComponentCode},
			{ID: "end", Type: dsl.ComponentEnd},
			{ID: "orphan", Type: dsl.ComponentSignature},
		},
		Edges: []dsl.Edge{
			{ID: "e1", Source: "entry", Target: "A"},
			{ID: "e2", Source: "A", Target: "B"},
			{ID: "e3", Source: "B", Target: "C"},
			{ID: "e4", Source: "C", Target: "end"},
		},
	}
	p, err := planner.New(w, planner.WithUntilNode("B"))
	require.NoError(t, err)
	ids := flattenLayers(p.Layers)
	assert.True(t, ids["entry"] && ids["A"] && ids["B"], "entry, A, B must be planned (the path to B)")
	assert.False(t, ids["C"], "C is downstream of until=B and must be skipped")
	assert.False(t, ids["end"], "End is downstream of until=B and must be skipped")
	assert.False(t, ids["orphan"], "orphan stays excluded under until-here")
}

func TestPlan_WithUntilNode_UnknownTargetErrors(t *testing.T) {
	_, err := planner.New(disconnectedWorkflow(), planner.WithUntilNode("does-not-exist"))
	require.Error(t, err)
	var une *planner.UnknownNodeError
	require.True(t, errors.As(err, &une), "expected UnknownNodeError, got %T", err)
	assert.Equal(t, "does-not-exist", une.NodeID)
}

func TestPlan_WithUntilNode_EntryItself(t *testing.T) {
	// Until = Entry should plan just Entry: nothing else is upstream.
	p, err := planner.New(linearWorkflow(), planner.WithUntilNode("A"))
	require.NoError(t, err)
	assert.Equal(t, [][]string{{"A"}}, p.Layers)
}

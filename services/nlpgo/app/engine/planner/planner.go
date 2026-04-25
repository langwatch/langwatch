// Package planner builds an execution plan from a parsed workflow.
// The planner validates the graph (cycle detection, edge sanity,
// supported node kinds), then groups nodes into topological layers so
// the executor can run each layer in parallel.
package planner

import (
	"fmt"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// supportedKinds is the set of node kinds the Go engine can execute in
// v1. Anything outside this set produces an UnsupportedNodeKindError so
// the TS app's feature-flag check can route the workflow back to
// Python. See _shared/contract.md §5.
var supportedKinds = map[dsl.ComponentType]struct{}{
	dsl.ComponentEntry:              {},
	dsl.ComponentEnd:                {},
	dsl.ComponentSignature:          {},
	dsl.ComponentCode:               {},
	dsl.ComponentHTTP:               {},
	dsl.ComponentPromptingTechnique: {},
}

// Plan is the result of validating + topologically sorting a workflow.
// Layers[i] holds node IDs that are safe to execute concurrently after
// every node in Layers[<i] has completed.
type Plan struct {
	Layers   [][]string
	Children map[string][]string
	Parents  map[string][]string
}

// CycleError signals a directed cycle in the workflow. The cycle slice
// lists the node ids in traversal order.
type CycleError struct {
	Cycle []string
}

func (e *CycleError) Error() string {
	return fmt.Sprintf("planner: cycle detected: %v", e.Cycle)
}

// UnknownNodeError signals an edge references a node id not present
// in Workflow.Nodes.
type UnknownNodeError struct {
	NodeID string
	Edge   string // edge id, "" if from a missing target/source on Nodes table
}

func (e *UnknownNodeError) Error() string {
	if e.Edge != "" {
		return fmt.Sprintf("planner: edge %q references unknown node %q", e.Edge, e.NodeID)
	}
	return fmt.Sprintf("planner: unknown node %q", e.NodeID)
}

// UnsupportedNodeKindError signals a node kind is outside the v1 Go
// scope. The TS app catches this kind and routes the request to the
// Python upstream.
type UnsupportedNodeKindError struct {
	NodeID string
	Kind   dsl.ComponentType
}

func (e *UnsupportedNodeKindError) Error() string {
	return fmt.Sprintf("planner: node %q has unsupported kind %q", e.NodeID, e.Kind)
}

// retiredKinds names node types that the LangWatch product no longer
// supports. The planner rejects them with RetiredNodeKindError so the
// Studio UI surfaces a clear "remove this node" error instead of
// either falling back to Python (which also wouldn't run them) or
// silently producing nothing.
//
// `retriever` was a v1 concept replaced by tool-call-based retrieval
// inside signature nodes; `custom` was historically a placeholder
// kind that never had a real executor.
var retiredKinds = map[dsl.ComponentType]string{
	dsl.ComponentType("retriever"): "retriever was retired; remove the node from the workflow",
	dsl.ComponentType("custom"):    "custom node kind is not supported; replace with code/http/agent/signature/evaluator",
}

// RetiredNodeKindError signals the workflow contains a node kind that
// LangWatch has formally retired. Distinct from
// UnsupportedNodeKindError so the TS app can show a different message
// (and not bother retrying via the Python upstream — it can't run
// these either).
type RetiredNodeKindError struct {
	NodeID  string
	Kind    dsl.ComponentType
	Message string
}

func (e *RetiredNodeKindError) Error() string {
	return fmt.Sprintf("planner: node %q has retired kind %q: %s", e.NodeID, e.Kind, e.Message)
}

// DuplicateNodeError signals two nodes share the same id.
type DuplicateNodeError struct {
	NodeID string
}

func (e *DuplicateNodeError) Error() string {
	return fmt.Sprintf("planner: duplicate node id %q", e.NodeID)
}

// New validates the workflow and returns its execution plan.
//
// Validation order:
//  1. Duplicate node ids
//  2. Unsupported node kinds
//  3. Edge endpoints exist in the node table
//  4. Cycle detection (DFS coloring)
//  5. Layered topological sort (Kahn's algorithm with stable ordering)
//
// Errors short-circuit at the first failure so the caller surfaces a
// single root cause to the customer.
func New(w *dsl.Workflow) (*Plan, error) {
	if w == nil {
		return nil, fmt.Errorf("planner: nil workflow")
	}

	// 1. Duplicate ids.
	nodeIDs := make(map[string]dsl.ComponentType, len(w.Nodes))
	for _, n := range w.Nodes {
		if _, exists := nodeIDs[n.ID]; exists {
			return nil, &DuplicateNodeError{NodeID: n.ID}
		}
		nodeIDs[n.ID] = n.Type
	}

	// 2. Retired + unsupported kinds. Retired comes first so a workflow
	// that has both a retired node and an unsupported one gets the more
	// actionable error.
	for _, n := range w.Nodes {
		if msg, retired := retiredKinds[n.Type]; retired {
			return nil, &RetiredNodeKindError{NodeID: n.ID, Kind: n.Type, Message: msg}
		}
		if _, ok := supportedKinds[n.Type]; !ok {
			return nil, &UnsupportedNodeKindError{NodeID: n.ID, Kind: n.Type}
		}
	}

	// 3. Edge sanity + 4. cycle detection done together via the
	// adjacency map. Build children + parents in stable order.
	children := make(map[string][]string, len(nodeIDs))
	parents := make(map[string][]string, len(nodeIDs))
	for id := range nodeIDs {
		children[id] = nil
		parents[id] = nil
	}
	for _, e := range w.Edges {
		if _, ok := nodeIDs[e.Source]; !ok {
			return nil, &UnknownNodeError{NodeID: e.Source, Edge: e.ID}
		}
		if _, ok := nodeIDs[e.Target]; !ok {
			return nil, &UnknownNodeError{NodeID: e.Target, Edge: e.ID}
		}
		children[e.Source] = append(children[e.Source], e.Target)
		parents[e.Target] = append(parents[e.Target], e.Source)
	}

	if cycle := findCycle(w.Nodes, children); len(cycle) > 0 {
		return nil, &CycleError{Cycle: cycle}
	}

	// 5. Layered topo sort. We seed with the input ordering of Nodes
	// to keep results stable across runs; a stable order helps both
	// debugging and integration-test diffs against Python output.
	layers := layerize(w.Nodes, children, parents)

	return &Plan{
		Layers:   layers,
		Children: children,
		Parents:  parents,
	}, nil
}

// findCycle returns one cycle path if the graph has a directed cycle,
// or nil otherwise. Uses DFS coloring (white/grey/black).
func findCycle(nodes []dsl.Node, children map[string][]string) []string {
	const (
		white = 0
		grey  = 1
		black = 2
	)
	color := make(map[string]int, len(nodes))
	parent := make(map[string]string, len(nodes))

	var dfs func(id string) []string
	dfs = func(id string) []string {
		color[id] = grey
		for _, c := range children[id] {
			switch color[c] {
			case white:
				parent[c] = id
				if cycle := dfs(c); cycle != nil {
					return cycle
				}
			case grey:
				// reconstruct cycle: c, parent[c], parent[parent[c]], …, c
				out := []string{c}
				cur := id
				for cur != c {
					out = append(out, cur)
					cur = parent[cur]
				}
				out = append(out, c)
				// reverse so it reads in traversal order
				for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
					out[i], out[j] = out[j], out[i]
				}
				return out
			}
		}
		color[id] = black
		return nil
	}
	for _, n := range nodes {
		if color[n.ID] == white {
			if cycle := dfs(n.ID); cycle != nil {
				return cycle
			}
		}
	}
	return nil
}

// layerize is Kahn's algorithm with stable ordering. Each iteration
// emits all currently-zero-indegree nodes (in original Nodes-order) as
// the next layer, then removes their out-edges and repeats.
func layerize(nodes []dsl.Node, children, parents map[string][]string) [][]string {
	indegree := make(map[string]int, len(nodes))
	for id, ps := range parents {
		indegree[id] = len(ps)
	}

	var layers [][]string
	remaining := len(nodes)
	for remaining > 0 {
		// Collect zero-indegree nodes preserving the input order so the
		// emitted plan is deterministic regardless of map iteration.
		var layer []string
		for _, n := range nodes {
			if _, exists := indegree[n.ID]; !exists {
				continue
			}
			if indegree[n.ID] == 0 {
				layer = append(layer, n.ID)
			}
		}
		if len(layer) == 0 {
			// Shouldn't happen — cycle detection ran first — but we
			// return what we have rather than infinite-loop.
			return layers
		}
		layers = append(layers, layer)
		for _, id := range layer {
			delete(indegree, id)
			for _, c := range children[id] {
				indegree[c]--
			}
			remaining--
		}
	}
	return layers
}

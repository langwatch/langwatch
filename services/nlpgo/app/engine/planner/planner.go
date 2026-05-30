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
	dsl.ComponentEvaluator:          {},
	dsl.ComponentAgent:              {},
	dsl.ComponentCustom:             {},
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
	dsl.ComponentRetriever: "retriever was retired; remove the node from the workflow",
	// `custom` kind was previously listed retired, but Studio's
	// NodeSelectionPanel.tsx actively writes `type: "custom"` when a
	// user drags a saved sub-workflow onto the canvas (with typed
	// data.workflow_id / data.version_id). The engine now handles it
	// via runCustom (engine.go) using the same agentblock.WorkflowRunner
	// as `agent_type=workflow`, so it executes on the Go path with parity
	// to Python's CustomNode.forward.
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

// Option tunes how New constructs the Plan. Functional options keep the
// common case (`planner.New(w)`) clean while allowing callers like
// engine.Engine to opt into reachability scoping.
type Option func(*planOptions)

type planOptions struct {
	untilNodeID string
}

// WithUntilNode restricts the plan to nodes on a path from the Entry to
// untilNodeID — the "Run until here" semantics in Studio. Nodes
// downstream of untilNodeID (and any sibling branches that don't feed
// it) are omitted from the plan. Mirrors Python's `find_path_until_node`
// in langwatch_nlp/studio/parser.py.
func WithUntilNode(id string) Option {
	return func(o *planOptions) { o.untilNodeID = id }
}

// New validates the workflow and returns its execution plan.
//
// Validation order:
//  1. Duplicate node ids
//  2. Unsupported node kinds
//  3. Edge endpoints exist in the node table
//  4. Cycle detection (DFS coloring)
//  5. Reachability scoping: full BFS from Entry (and a backward DFS from
//     untilNodeID when provided) — disconnected nodes never enter the
//     plan. Mirrors Python's `find_reachable_nodes` /
//     `find_path_until_node` in studio/parser.py.
//  6. Layered topological sort (Kahn's algorithm with stable ordering)
//
// Errors short-circuit at the first failure so the caller surfaces a
// single root cause to the customer.
func New(w *dsl.Workflow, opts ...Option) (*Plan, error) {
	o := planOptions{}
	for _, opt := range opts {
		opt(&o)
	}
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

	// 5. Reachability scope. The Studio canvas tolerates nodes the
	// author hasn't wired up yet — an orphan LLM node, a disconnected
	// sub-chain. Python parity is to skip those: a full run includes
	// only nodes reachable forward from Entry, and a "Run until here"
	// further trims to the backward dependency path of the target node.
	//
	// allowed=nil means the workflow has no Entry node (a malformed or
	// pre-canonical-shape graph, mostly seen in unit fixtures) — in
	// that case we fall back to the legacy "include every node" so
	// those tests + customer workflows authored without the explicit
	// Entry convention keep planning.
	allowed := reachableFromEntry(w.Nodes, children)
	if o.untilNodeID != "" {
		if _, ok := nodeIDs[o.untilNodeID]; !ok {
			return nil, &UnknownNodeError{NodeID: o.untilNodeID}
		}
		path := pathToUntilNode(o.untilNodeID, parents)
		if allowed != nil {
			// Intersect: a node must be both reachable from Entry AND on
			// the backward path from untilNodeID. Drops orphan ancestors
			// of the target that aren't actually wired to Entry.
			for id := range path {
				if !allowed[id] {
					delete(path, id)
				}
			}
		}
		allowed = path
	}

	// 6. Layered topo sort. We seed with the input ordering of Nodes
	// to keep results stable across runs; a stable order helps both
	// debugging and integration-test diffs against Python output.
	layers := layerize(w.Nodes, children, parents, allowed)

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
// the next layer, then removes their out-edges and repeats. `allowed`
// scopes the plan to a subset (reachable-from-Entry, optionally
// intersected with the until-here path); allowed=nil includes every
// node.
func layerize(nodes []dsl.Node, children, parents map[string][]string, allowed map[string]bool) [][]string {
	indegree := make(map[string]int, len(nodes))
	remaining := 0
	for _, n := range nodes {
		if allowed != nil && !allowed[n.ID] {
			continue
		}
		// Count only parents that will themselves execute — a disallowed
		// parent never fires and never decrements, so including it in
		// indegree would strand its child forever.
		cnt := 0
		for _, p := range parents[n.ID] {
			if allowed == nil || allowed[p] {
				cnt++
			}
		}
		indegree[n.ID] = cnt
		remaining++
	}

	var layers [][]string
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
				// Guard: with reachability scoping the child may be
				// out of scope (e.g. "Run until here" trims a downstream
				// child of an in-scope node). indexed access would
				// create a phantom indegree entry at -1.
				if _, ok := indegree[c]; ok {
					indegree[c]--
				}
			}
			remaining--
		}
	}
	return layers
}

// reachableFromEntry returns the set of node IDs reachable forward from
// the Entry node by following children edges (BFS). Returns nil when
// the workflow has no node of type ComponentEntry — the caller treats
// nil as "no filter" so pre-canonical fixtures + workflows that don't
// declare an explicit Entry still plan.
//
// Mirrors langwatch_nlp/studio/parser.py:605 `find_reachable_nodes`.
func reachableFromEntry(nodes []dsl.Node, children map[string][]string) map[string]bool {
	entryID := ""
	for _, n := range nodes {
		if n.Type == dsl.ComponentEntry {
			entryID = n.ID
			break
		}
	}
	if entryID == "" {
		return nil
	}
	visited := map[string]bool{entryID: true}
	queue := []string{entryID}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, c := range children[cur] {
			if !visited[c] {
				visited[c] = true
				queue = append(queue, c)
			}
		}
	}
	return visited
}

// pathToUntilNode returns the set of node IDs on a backward path from
// untilNodeID to the workflow's roots (following parent edges via DFS).
// Used by "Run until here" to trim everything that isn't a transitive
// dependency of the target.
//
// Mirrors langwatch_nlp/studio/parser.py:531 `find_path_until_node`.
func pathToUntilNode(untilNodeID string, parents map[string][]string) map[string]bool {
	visited := map[string]bool{}
	var dfs func(id string)
	dfs = func(id string) {
		if visited[id] {
			return
		}
		visited[id] = true
		for _, p := range parents[id] {
			dfs(p)
		}
	}
	dfs(untilNodeID)
	return visited
}

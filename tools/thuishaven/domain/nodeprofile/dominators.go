package nodeprofile

import (
	"fmt"
	"slices"
	"sort"
	"strings"
)

// domTree is a snapshot's dominator tree: each node's immediate dominator
// (-1 when unreachable from the root) and its retained size in bytes.
type domTree struct {
	idom     []int32
	retained []float64
}

// dominators computes each node's immediate dominator from the root (node 0),
// ignoring weak edges, with the iterative algorithm of Cooper, Harvey and
// Kennedy over a post-order, and from it every node's retained size.
func dominators(v *snapshotView) domTree {
	idom := make([]int32, v.n)
	for i := range idom {
		idom[i] = -1
	}
	if v.n == 0 {
		return domTree{idom: idom}
	}
	idom[0] = 0
	preds, predStart := predecessors(v)
	order, post := postOrder(v)
	d := domSolver{idom: idom, order: order, preds: preds, predStart: predStart}
	for rounds := 0; rounds < 50; rounds++ {
		if !d.pass(post) {
			break
		}
	}
	retained := make([]float64, v.n)
	for _, node := range post {
		retained[node] += v.sizeOf(int(node))
		if node != 0 && idom[node] >= 0 {
			retained[idom[node]] += retained[node]
		}
	}
	return domTree{idom: idom, retained: retained}
}

// domSolver holds the state of the iterative dominator computation.
type domSolver struct {
	idom             []int32
	order            []int32
	preds, predStart []uint32
}

// pass updates every reachable node's dominator once, in reverse post-order,
// and reports whether any changed.
func (d *domSolver) pass(post []uint32) bool {
	changed := false
	for k := len(post) - 2; k >= 0; k-- {
		node := post[k]
		if nd := d.meet(node); nd != -1 && d.idom[node] != nd {
			d.idom[node] = nd
			changed = true
		}
	}
	return changed
}

// meet intersects the dominators of node's processed predecessors.
func (d *domSolver) meet(node uint32) int32 {
	nd := int32(-1)
	for p := d.predStart[node]; p < d.predStart[node+1]; p++ {
		u := int32(d.preds[p])
		if d.order[u] < 0 || d.idom[u] == -1 {
			continue
		}
		if nd == -1 {
			nd = u
			continue
		}
		nd = d.intersect(u, nd)
	}
	return nd
}

func (d *domSolver) intersect(a, b int32) int32 {
	for a != b {
		for d.order[a] < d.order[b] {
			a = d.idom[a]
		}
		for d.order[b] < d.order[a] {
			b = d.idom[b]
		}
	}
	return a
}

// predecessors lists, per node, the nodes with a strong edge to it (CSR form).
func predecessors(v *snapshotView) ([]uint32, []uint32) {
	count := make([]uint32, v.n+1)
	v.eachStrongEdge(func(_ int, to int) { count[to+1]++ })
	for i := 1; i <= v.n; i++ {
		count[i] += count[i-1]
	}
	preds := make([]uint32, count[v.n])
	fill := slices.Clone(count[:v.n])
	v.eachStrongEdge(func(from, to int) {
		preds[fill[to]] = uint32(from)
		fill[to]++
	})
	return preds, count
}

func (v *snapshotView) eachStrongEdge(fn func(from, to int)) {
	for i := 0; i < v.n; i++ {
		for e := v.firstEdge[i]; e < v.firstEdge[i+1]; e += uint32(v.ef) {
			if !v.isWeak(e) {
				fn(i, v.edgeTarget(e))
			}
		}
	}
}

// postOrder numbers the nodes reachable from the root over strong edges;
// order[i] is -1 for an unreachable node.
func postOrder(v *snapshotView) ([]int32, []uint32) {
	order := make([]int32, v.n)
	for i := range order {
		order[i] = -1
	}
	post := make([]uint32, 0, v.n)
	if v.n == 0 {
		return order, post
	}
	const visiting = -2
	stack, next := []int{0}, []uint32{v.firstEdge[0]}
	order[0] = visiting
	for len(stack) > 0 {
		top := len(stack) - 1
		node := stack[top]
		to, resume := v.unvisitedChild(node, next[top], order)
		if to < 0 {
			stack, next = stack[:top], next[:top]
			order[node] = int32(len(post))
			post = append(post, uint32(node))
			continue
		}
		next[top] = resume
		order[to] = visiting
		stack, next = append(stack, to), append(next, v.firstEdge[to])
	}
	return order, post
}

// unvisitedChild is node's first strong child at or after edge e not yet
// visited, and the edge to resume from; -1 when there is none.
func (v *snapshotView) unvisitedChild(node int, e uint32, order []int32) (int, uint32) {
	for ; e < v.firstEdge[node+1]; e += uint32(v.ef) {
		if v.isWeak(e) {
			continue
		}
		if to := v.edgeTarget(e); order[to] == -1 {
			return to, e + uint32(v.ef)
		}
	}
	return -1, e
}

// retainers rolls retained size up by constructor, counting an object only
// when no object of the same constructor dominates it (so nested Objects are
// not counted twice and no row exceeds the heap), and lists the biggest holders.
func (v *snapshotView) retainers(t domTree, limit int) ([]SizeRow, []Retained) {
	byCtor := map[string]*SizeRow{}
	v.walkDominatorTree(t.idom, func(node int, outermost func(name string) bool) {
		if !isObjectLike(v.typeOf(node)) {
			return
		}
		if name := clip(v.nameOf(node), 80); outermost(name) {
			addSize(byCtor, SizeRow{Name: name, Count: 1}, t.retained[node])
		}
	})
	var big []int
	for i := 1; i < v.n; i++ {
		if t.idom[i] >= 0 && v.typeOf(i) != "synthetic" && t.retained[i] >= mib {
			big = append(big, i)
		}
	}
	sort.Slice(big, func(a, b int) bool { return t.retained[big[a]] > t.retained[big[b]] })
	top := []Retained{}
	for _, i := range head(big, limit) {
		top = append(top, Retained{Name: clip(v.nameOf(i), 70), Type: v.typeOf(i), MB: t.retained[i] / mib, Path: v.dominatorPath(i, t.idom)})
	}
	return head(rankedSizes(byCtor, v.total), limit), top
}

// walkDominatorTree visits every reachable node parent first. visit's
// outermost reports whether no dominator above the node was entered under
// the same name, and marks the name entered for the node's subtree.
func (v *snapshotView) walkDominatorTree(idom []int32, visit func(node int, outermost func(name string) bool)) {
	start, kids := dominatorChildren(idom)
	open := map[string]int{}
	type frame struct {
		node    int
		next    uint32
		entered string
	}
	var stack []frame
	enter := func(node int) {
		f := frame{node: node, next: start[node]}
		visit(node, func(name string) bool {
			open[name]++
			f.entered = name
			return open[name] == 1
		})
		stack = append(stack, f)
	}
	if len(idom) > 0 {
		enter(0)
	}
	for len(stack) > 0 {
		top := &stack[len(stack)-1]
		if top.next < start[top.node+1] {
			top.next++
			enter(int(kids[top.next-1]))
			continue
		}
		if top.entered != "" {
			open[top.entered]--
		}
		stack = stack[:len(stack)-1]
	}
}

// dominatorChildren lists each node's children in the dominator tree (CSR).
func dominatorChildren(idom []int32) ([]uint32, []uint32) {
	n := len(idom)
	start := make([]uint32, n+1)
	for i := 1; i < n; i++ {
		if idom[i] >= 0 {
			start[idom[i]+1]++
		}
	}
	for i := 1; i <= n; i++ {
		start[i] += start[i-1]
	}
	kids := make([]uint32, start[n])
	fill := slices.Clone(start[:n])
	for i := 1; i < n; i++ {
		if p := idom[i]; p >= 0 {
			kids[fill[p]] = uint32(i)
			fill[p]++
		}
	}
	return start, kids
}

// dominatorPath names the chain of dominators above node, nearest first,
// each with the property it holds the next one by ("..." when it holds it
// only through objects it alone keeps alive).
func (v *snapshotView) dominatorPath(node int, idom []int32) string {
	var parts []string
	cur := node
	for depth := 0; depth < 6 && cur != 0 && idom[cur] > 0; depth++ {
		p := int(idom[cur])
		edge := v.edgeName(p, cur)
		if edge == "" {
			edge = "..."
		}
		parts = append(parts, edge+" "+clip(strings.TrimSpace(strings.TrimSuffix(v.nameOf(p), " / ")), 30))
		cur = p
	}
	if len(parts) == 0 {
		return "(a GC root)"
	}
	return strings.Join(parts, " <- ")
}

// edgeName is the name of from's edge to to, "" when it has none.
func (v *snapshotView) edgeName(from, to int) string {
	for e := v.firstEdge[from]; e < v.firstEdge[from+1]; e += uint32(v.ef) {
		if v.edgeTarget(e) != to {
			continue
		}
		n := v.s.Edges[int(e)+v.eName]
		if t := v.edgeType(e); t == "element" || t == "hidden" {
			return fmt.Sprintf("[%d]", n)
		}
		if int(n) < len(v.s.Strings) {
			return v.s.Strings[n]
		}
	}
	return ""
}

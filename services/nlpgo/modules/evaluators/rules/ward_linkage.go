package rules

import (
	"errors"
	"math"
	"runtime"
	"slices"
	"sync"
	"sync/atomic"
)

// Linkage errors, as scipy raises them.
var (
	ErrTooFewObservations = errors.New("linkage needs at least 2 observations")
	ErrNonFiniteDistance  = errors.New("the condensed distance matrix must contain only finite values")
	// ErrPairwiseDistanceFailed is a pdist goroutine that panicked, such as
	// on vectors of different lengths; the panic value is not kept.
	ErrPairwiseDistanceFailed = errors.New("pairwise distances could not be computed")
)

// Merge is one row of scipy's linkage matrix Z.
type Merge struct {
	A, B   int
	Height float64
	Size   int
}

// condensed is scipy's condensed_index for i != j.
func condensed(n, i, j int) int {
	if i > j {
		i, j = j, i
	}
	return n*i - i*(i+1)/2 + (j - i - 1)
}

// Pdist is scipy's pdist(X, "euclidean"): each pair summed in index order.
// Rows are spread over goroutines; every pair is still summed the same way.
// A goroutine's panic is ErrPairwiseDistanceFailed, never the process's.
func Pdist(vectors [][]float64) ([]float64, error) {
	n := len(vectors)
	out := make([]float64, n*(n-1)/2)
	rows := make(chan int, n)
	for i := range n {
		rows <- i
	}
	close(rows)
	var wg sync.WaitGroup
	var panicked atomic.Bool
	for range runtime.GOMAXPROCS(0) {
		wg.Go(func() {
			defer func() {
				if recover() != nil {
					panicked.Store(true)
				}
			}()
			for i := range rows {
				pdistRow(vectors, i, out)
			}
		})
	}
	wg.Wait()
	if panicked.Load() {
		return nil, ErrPairwiseDistanceFailed
	}
	return out, nil
}

// pdistRow fills row i of the condensed matrix, four pairs per pass.
func pdistRow(vectors [][]float64, i int, out []float64) {
	n := len(vectors)
	a := vectors[i]
	base := condensed(n, i, i+1) - (i + 1)
	j := i + 1
	for ; j+4 <= n; j += 4 {
		euclidean4(a, vectors[j:j+4], out[base+j:base+j+4])
	}
	for ; j < n; j++ {
		out[base+j] = euclidean(a, vectors[j])
	}
}

// euclidean4 sums four pairs side by side so their adds overlap; each pair
// is still summed in index order.
func euclidean4(a []float64, b [][]float64, out []float64) {
	b0, b1, b2, b3 := b[0], b[1], b[2], b[3]
	var s0, s1, s2, s3 float64
	for k, x := range a {
		d0, d1, d2, d3 := x-b0[k], x-b1[k], x-b2[k], x-b3[k]
		s0 += float64(d0 * d0)
		s1 += float64(d1 * d1)
		s2 += float64(d2 * d2)
		s3 += float64(d3 * d3)
	}
	out[0], out[1], out[2], out[3] = math.Sqrt(s0), math.Sqrt(s1), math.Sqrt(s2), math.Sqrt(s3)
}

func euclidean(a, b []float64) float64 {
	var s float64
	for k := range a {
		d := a[k] - b[k]
		s += float64(d * d)
	}
	return math.Sqrt(s)
}

// WardLinkage is scipy's linkage(X, "ward"): nn_chain over the condensed
// matrix (updated in place), a stable sort by height, then label().
func WardLinkage(n int, dist []float64) ([]Merge, error) {
	if n < 2 {
		return nil, ErrTooFewObservations
	}
	if slices.ContainsFunc(dist, isNonFinite) {
		return nil, ErrNonFiniteDistance
	}
	chain := newNNChain(n, dist)
	z := make([]Merge, n-1)
	for k := range z {
		z[k] = chain.merge()
	}
	slices.SortStableFunc(z, byHeight)
	label(z, n)
	return z, nil
}

func isNonFinite(d float64) bool { return math.IsNaN(d) || math.IsInf(d, 0) }

func byHeight(a, b Merge) int {
	switch {
	case a.Height < b.Height:
		return -1
	case a.Height > b.Height:
		return 1
	}
	return 0
}

// nnChain is scipy's nearest-neighbor chain state; a size of 0 is a dead cluster.
type nnChain struct {
	n     int
	dist  []float64
	size  []int
	chain []int
}

func newNNChain(n int, dist []float64) *nnChain {
	size := make([]int, n)
	for i := range size {
		size[i] = 1
	}
	return &nnChain{n: n, dist: dist, size: size, chain: make([]int, 0, n)}
}

// merge joins the next pair of mutual nearest neighbors: the merged cluster
// lives in the larger slot, the smaller dies.
func (c *nnChain) merge() Merge {
	if len(c.chain) == 0 {
		c.chain = append(c.chain, slices.IndexFunc(c.size, func(s int) bool { return s > 0 }))
	}
	x, y, height := c.walk()
	c.chain = c.chain[:len(c.chain)-2]
	if x > y {
		x, y = y, x
	}
	nx := c.size[x]
	m := Merge{A: x, B: y, Height: height, Size: nx + c.size[y]}
	c.size[x], c.size[y] = 0, m.Size
	c.update(m, nx)
	return m
}

// walk extends the chain until its last element's nearest neighbor is the
// element before it.
func (c *nnChain) walk() (x, y int, height float64) {
	for {
		x = c.chain[len(c.chain)-1]
		y, height = c.nearest(x)
		if len(c.chain) > 1 && y == c.chain[len(c.chain)-2] {
			return x, y, height
		}
		c.chain = append(c.chain, y)
	}
}

// nearest is x's nearest live cluster (strict <, scanning up), preferring
// the previous chain element on a tie so the chain cannot cycle.
func (c *nnChain) nearest(x int) (y int, d float64) {
	y, d = -1, math.Inf(1)
	if len(c.chain) > 1 {
		y = c.chain[len(c.chain)-2]
		d = c.dist[condensed(c.n, x, y)]
	}
	for i := range c.n {
		if c.size[i] == 0 || i == x {
			continue
		}
		if di := c.dist[condensed(c.n, x, i)]; di < d {
			y, d = i, di
		}
	}
	return y, d
}

// update applies the Ward update to every live cluster's distance to m.B.
func (c *nnChain) update(m Merge, nx int) {
	for i := range c.n {
		ni := c.size[i]
		if ni == 0 || i == m.B {
			continue
		}
		iy := condensed(c.n, i, m.B)
		c.dist[iy] = ward(wardInput{
			dxi: c.dist[condensed(c.n, i, m.A)], dyi: c.dist[iy], dxy: m.Height,
			nx: nx, ny: m.Size - nx, ni: ni,
		})
	}
}

// wardInput is one Lance-Williams update: cluster i's distances to the
// merged pair x and y, the pair's own distance, and the three sizes.
type wardInput struct {
	dxi, dyi, dxy float64
	nx, ny, ni    int
}

// ward is scipy's _ward Lance-Williams update; the conversions stop Go
// fusing a multiply into the following add.
func ward(in wardInput) float64 {
	t := 1.0 / float64(in.nx+in.ny+in.ni)
	a := float64(float64(in.ni+in.nx) * t * in.dxi * in.dxi)
	b := float64(float64(in.ni+in.ny) * t * in.dyi * in.dyi)
	c := float64(float64(in.ni) * t * in.dxy * in.dxy)
	return math.Sqrt(float64(a+b) - c)
}

// label renames each row to its current cluster roots, smaller first, and
// numbers new clusters n, n+1, ... in row order (scipy's LinkageUnionFind).
func label(z []Merge, n int) {
	parent := make([]int, 2*n-1)
	size := make([]int, 2*n-1)
	for i := range parent {
		parent[i], size[i] = i, 1
	}
	next := n
	for i := range z {
		a, b := find(parent, z[i].A), find(parent, z[i].B)
		if a > b {
			a, b = b, a
		}
		parent[a], parent[b] = next, next
		size[next] = size[a] + size[b]
		z[i].A, z[i].B, z[i].Size = a, b, size[next]
		next++
	}
}

// find is the union-find root of x, compressing the path behind it.
func find(parent []int, x int) int {
	root := x
	for parent[root] != root {
		root = parent[root]
	}
	for parent[x] != root {
		parent[x], x = root, parent[x]
	}
	return root
}

// FlatClustersByDistance is scipy's fcluster(Z, t, "distance"): labels 1..k
// in the order of scipy's depth-first walk from the root, left child first.
func FlatClustersByDistance(z []Merge, t float64) []int {
	n := len(z) + 1
	if n == 1 {
		return []int{1}
	}
	w := &flatWalk{
		z: z, n: n, cutoff: t, maxDist: maxDistances(z, n),
		labels: make([]int, n), visited: make([]bool, 2*n-1), stack: []int{2*n - 2}, leader: -1,
	}
	for len(w.stack) > 0 {
		w.step()
	}
	return w.labels
}

// maxDistances is each merge's height or its children's, whichever is higher.
func maxDistances(z []Merge, n int) []float64 {
	maxDist := make([]float64, len(z))
	for i, m := range z {
		maxDist[i] = m.Height
		for _, child := range []int{m.A, m.B} {
			if child >= n {
				maxDist[i] = max(maxDist[i], maxDist[child-n])
			}
		}
	}
	return maxDist
}

// flatWalk is scipy's cluster_monocrit walk state.
type flatWalk struct {
	z       []Merge
	n       int
	cutoff  float64
	maxDist []float64
	labels  []int
	visited []bool
	stack   []int
	count   int
	leader  int
}

// step visits the node on top of the stack: it may open a cluster, descend
// into an unvisited child, or label its leaves and pop.
func (w *flatWalk) step() {
	root := w.stack[len(w.stack)-1] - w.n
	if w.leader == -1 && w.maxDist[root] <= w.cutoff {
		w.leader = root
		w.count++
	}
	if w.descend(w.z[root].A) || w.descend(w.z[root].B) {
		return
	}
	w.labelLeaf(w.z[root].A)
	w.labelLeaf(w.z[root].B)
	if w.leader == root {
		w.leader = -1
	}
	w.stack = w.stack[:len(w.stack)-1]
}

func (w *flatWalk) descend(child int) bool {
	if child < w.n || w.visited[child] {
		return false
	}
	w.visited[child] = true
	w.stack = append(w.stack, child)
	return true
}

// labelLeaf labels a leaf; outside any cluster it opens its own.
func (w *flatWalk) labelLeaf(leaf int) {
	if leaf >= w.n {
		return
	}
	if w.leader == -1 {
		w.count++
	}
	w.labels[leaf] = w.count
}

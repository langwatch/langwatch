package nodeprofile

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

// HeapNode is one node of a sampling heap profile's allocation tree.
type HeapNode struct {
	CallFrame CallFrame  `json:"callFrame"`
	SelfSize  float64    `json:"selfSize"`
	ID        int        `json:"id"`
	Children  []HeapNode `json:"children"`
}

// HeapProfile is the HeapProfiler.stopSampling result (.heapprofile).
type HeapProfile struct {
	Head HeapNode `json:"head"`
}

// ParseHeapProfile decodes a sampling heap profile.
func ParseHeapProfile(raw []byte) (HeapProfile, error) {
	var p HeapProfile
	if err := json.Unmarshal(raw, &p); err != nil {
		return p, fmt.Errorf("not a sampling heap profile: %w", err)
	}
	return p, nil
}

// SizeRow is one line of a memory table: a name (and where it lives), its
// size in MiB, its share of the table's total and, where it means something,
// how many objects.
type SizeRow struct {
	Name  string  `json:"name"`
	Where string  `json:"where,omitempty"`
	MB    float64 `json:"mb"`
	Pct   float64 `json:"pct"`
	Count int     `json:"count,omitempty"`
}

// HeapAnalysis is a sampling heap profile rolled up: the sampled bytes still
// allocated (or, sampled with collected objects included, all allocated over
// the window) by the function that allocated them.
type HeapAnalysis struct {
	TotalMB    float64   `json:"totalMb"`
	ByFunction []SizeRow `json:"byFunction"`
	ByFile     []SizeRow `json:"byFile"`
	ByPackage  []SizeRow `json:"byPackage"`
}

const mib = 1 << 20

// AnalyseHeap rolls a sampling heap profile up by function, file and package.
func AnalyseHeap(p HeapProfile, root string) HeapAnalysis {
	fn, file, pkg := map[string]*SizeRow{}, map[string]*SizeRow{}, map[string]*SizeRow{}
	var total float64
	var walk func(n *HeapNode)
	walk = func(n *HeapNode) {
		if n.SelfSize > 0 {
			cf := n.CallFrame
			total += n.SelfSize
			where := DisplayPath(cf.URL, root)
			fnWhere := ""
			if where != "" {
				fnWhere = where + ":" + strconv.Itoa(cf.LineNumber+1)
				addSize(file, SizeRow{Name: where}, n.SelfSize)
			}
			addSize(fn, SizeRow{Name: functionLabel(cf.FunctionName), Where: fnWhere}, n.SelfSize)
			addSize(pkg, SizeRow{Name: PackageOf(cf.URL, cf.FunctionName, root)}, n.SelfSize)
		}
		for i := range n.Children {
			walk(&n.Children[i])
		}
	}
	walk(&p.Head)
	return HeapAnalysis{
		TotalMB:    total / mib,
		ByFunction: rankedSizes(fn, total),
		ByFile:     rankedSizes(file, total),
		ByPackage:  rankedSizes(pkg, total),
	}
}

// addSize adds bytes, and row's Count, to the row keyed by row's name and where.
func addSize(m map[string]*SizeRow, row SizeRow, bytes float64) {
	key := row.Name + "\x00" + row.Where
	r, ok := m[key]
	if !ok {
		r = &SizeRow{Name: row.Name, Where: row.Where}
		m[key] = r
	}
	r.MB += bytes / mib
	r.Count += row.Count
}

func rankedSizes(m map[string]*SizeRow, totalBytes float64) []SizeRow {
	out := make([]SizeRow, 0, len(m))
	for _, r := range m {
		row := *r
		row.Pct = pct(row.MB*mib, totalBytes)
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].MB != out[j].MB {
			return out[i].MB > out[j].MB
		}
		return out[i].Name+out[i].Where < out[j].Name+out[j].Where
	})
	return out
}

// Top is the analysis with every table cut to its first n rows.
func (h HeapAnalysis) Top(n int) HeapAnalysis {
	h.ByFunction, h.ByFile, h.ByPackage = head(h.ByFunction, n), head(h.ByFile, n), head(h.ByPackage, n)
	return h
}

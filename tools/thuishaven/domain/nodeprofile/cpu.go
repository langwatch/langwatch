package nodeprofile

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

// CallFrame is where a profile node's code lives. LineNumber is zero-based,
// as V8 sends it.
type CallFrame struct {
	FunctionName string `json:"functionName"`
	URL          string `json:"url"`
	LineNumber   int    `json:"lineNumber"`
	ColumnNumber int    `json:"columnNumber"`
}

// CPUNode is one node of a .cpuprofile's call tree.
type CPUNode struct {
	ID        int       `json:"id"`
	CallFrame CallFrame `json:"callFrame"`
	Children  []int     `json:"children"`
}

// CPUProfile is the Profiler.stop result, the file Chrome DevTools opens.
// Times are microseconds.
type CPUProfile struct {
	Nodes      []CPUNode `json:"nodes"`
	StartTime  int64     `json:"startTime"`
	EndTime    int64     `json:"endTime"`
	Samples    []int     `json:"samples"`
	TimeDeltas []int64   `json:"timeDeltas"`
}

// ParseCPUProfile decodes a .cpuprofile.
func ParseCPUProfile(raw []byte) (CPUProfile, error) {
	var p CPUProfile
	if err := json.Unmarshal(raw, &p); err != nil {
		return p, fmt.Errorf("not a .cpuprofile: %w", err)
	}
	if len(p.Nodes) == 0 {
		return p, fmt.Errorf("not a .cpuprofile: no nodes")
	}
	return p, nil
}

// Row is one line of a self-time table: a function (with where it lives), a
// file or a package, its time in milliseconds and its share of the profile.
type Row struct {
	Name  string  `json:"name"`
	Where string  `json:"where,omitempty"`
	Ms    float64 `json:"ms"`
	Pct   float64 `json:"pct"`
}

// Key identifies a row across two profiles.
func (r Row) Key() string { return r.Name + "\x00" + r.Where }

// CPUAnalysis is a CPU profile rolled up. Every percentage is of the sampled
// time, which is the profile's wall time; busy is everything but (idle).
type CPUAnalysis struct {
	DurationMs float64 `json:"durationMs"`
	Samples    int     `json:"samples"`
	IntervalUs float64 `json:"intervalUs"`
	BusyPct    float64 `json:"busyPct"`
	GCPct      float64 `json:"gcPct"`
	ProgramPct float64 `json:"programPct"`
	IdlePct    float64 `json:"idlePct"`
	ByFunction []Row   `json:"byFunction"`
	ByFile     []Row   `json:"byFile"`
	ByPackage  []Row   `json:"byPackage"`
	Inclusive  []Row   `json:"inclusive"`
}

// AnalyseCPU rolls a profile up. root is the repository directory, so its own
// files read relative to it. (idle) is left out of the tables: it is the
// header's idle share, not work.
func AnalyseCPU(p CPUProfile, root string) CPUAnalysis {
	r := newCPURollup(p, root)
	for id, us := range sampleTimes(p) {
		if n, ok := r.byID[id]; ok {
			r.addSample(n, us)
		}
	}
	a := CPUAnalysis{Samples: len(p.Samples), DurationMs: float64(p.EndTime-p.StartTime) / 1000}
	if a.Samples > 0 {
		a.IntervalUs = r.total / float64(a.Samples)
	}
	a.IdlePct, a.GCPct, a.ProgramPct = pct(r.idle, r.total), pct(r.gc, r.total), pct(r.program, r.total)
	if r.total > 0 {
		a.BusyPct = 100 - a.IdlePct
	}
	a.ByFunction, a.ByFile = ranked(r.fn, r.total), ranked(r.file, r.total)
	a.ByPackage, a.Inclusive = ranked(r.pkg, r.total), ranked(r.incl, r.total)
	return a
}

// cpuRollup accumulates sampled time into the analysis tables.
type cpuRollup struct {
	root                     string
	byID                     map[int]*CPUNode
	parent                   map[int]int
	fn, file, pkg, incl      map[string]Row
	total, idle, gc, program float64
}

func newCPURollup(p CPUProfile, root string) *cpuRollup {
	r := &cpuRollup{
		root: root, byID: make(map[int]*CPUNode, len(p.Nodes)), parent: make(map[int]int, len(p.Nodes)),
		fn: map[string]Row{}, file: map[string]Row{}, pkg: map[string]Row{}, incl: map[string]Row{},
	}
	for i := range p.Nodes {
		n := &p.Nodes[i]
		r.byID[n.ID] = n
		for _, c := range n.Children {
			r.parent[c] = n.ID
		}
	}
	return r
}

// addSample books us of time sampled in node n: its self time, and once per
// distinct frame on its stack its inclusive time.
func (r *cpuRollup) addSample(n *CPUNode, us float64) {
	r.total += us
	cf := n.CallFrame
	switch cf.FunctionName {
	case "(idle)":
		r.idle += us
		return
	case "(garbage collector)":
		r.gc += us
	case "(program)":
		r.program += us
	}
	add(r.fn, frameRow(cf, r.root), us)
	if where := DisplayPath(cf.URL, r.root); where != "" {
		add(r.file, Row{Name: where}, us)
	}
	add(r.pkg, Row{Name: PackageOf(cf.URL, cf.FunctionName, r.root)}, us)
	r.addInclusive(n.ID, us)
}

func (r *cpuRollup) addInclusive(id int, us float64) {
	seen := map[string]bool{}
	for cur, ok := id, true; ok; cur, ok = r.parent[cur] {
		node := r.byID[cur]
		if node == nil || node.CallFrame.FunctionName == "(root)" {
			return
		}
		row := frameRow(node.CallFrame, r.root)
		if !seen[row.Key()] {
			seen[row.Key()] = true
			add(r.incl, row, us)
		}
	}
}

// sampleTimes is each node's sampled time in microseconds. Sample i lasts until
// sample i+1 (the last until the profile's end), so a sample stretched by a
// pause carries the pause, as DevTools attributes it.
func sampleTimes(p CPUProfile) map[int]float64 {
	out := map[int]float64{}
	if len(p.Samples) == 0 {
		return out
	}
	stamps := make([]int64, len(p.Samples))
	at := p.StartTime
	for i := range p.Samples {
		if i < len(p.TimeDeltas) {
			at += p.TimeDeltas[i]
		}
		stamps[i] = at
	}
	for i, id := range p.Samples {
		end := p.EndTime
		if i+1 < len(stamps) {
			end = stamps[i+1]
		}
		if d := end - stamps[i]; d > 0 {
			out[id] += float64(d)
		}
	}
	return out
}

func frameRow(cf CallFrame, root string) Row {
	r := Row{Name: functionLabel(cf.FunctionName)}
	if where := DisplayPath(cf.URL, root); where != "" {
		r.Where = where + ":" + strconv.Itoa(cf.LineNumber+1)
	}
	return r
}

func add(m map[string]Row, r Row, us float64) {
	have := m[r.Key()]
	have.Name, have.Where = r.Name, r.Where
	have.Ms += us / 1000
	m[r.Key()] = have
}

func pct(part, total float64) float64 {
	if total <= 0 {
		return 0
	}
	return 100 * part / total
}

// ranked sorts rows by time, biggest first, filling in each share.
func ranked(m map[string]Row, totalUs float64) []Row {
	out := make([]Row, 0, len(m))
	for _, r := range m {
		r.Pct = pct(r.Ms*1000, totalUs)
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Ms != out[j].Ms {
			return out[i].Ms > out[j].Ms
		}
		return out[i].Key() < out[j].Key()
	})
	return out
}

// Top is the analysis with every table cut to its first n rows.
func (a CPUAnalysis) Top(n int) CPUAnalysis {
	a.ByFunction, a.ByFile, a.ByPackage, a.Inclusive = head(a.ByFunction, n), head(a.ByFile, n), head(a.ByPackage, n), head(a.Inclusive, n)
	return a
}

func head[T any](rows []T, n int) []T {
	if n > 0 && len(rows) > n {
		return rows[:n]
	}
	return rows
}

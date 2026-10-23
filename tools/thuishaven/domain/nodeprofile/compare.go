package nodeprofile

import (
	"math"
	"sort"
	"strings"
)

// Delta is one function's or package's self time in two profiles, as a share
// of each profile's time, so profiles of different lengths compare.
type Delta struct {
	Name      string  `json:"name"`
	Where     string  `json:"where,omitempty"`
	BeforePct float64 `json:"beforePct"`
	AfterPct  float64 `json:"afterPct"`
	DeltaPct  float64 `json:"deltaPct"`
	BeforeMs  float64 `json:"beforeMs"`
	AfterMs   float64 `json:"afterMs"`
}

// Header is the top line of one profile in a comparison.
type Header struct {
	DurationMs float64 `json:"durationMs"`
	Samples    int     `json:"samples"`
	BusyPct    float64 `json:"busyPct"`
	GCPct      float64 `json:"gcPct"`
}

// Comparison is what a change did: before and after, and per function and
// per package the self-time shares that moved most, biggest move first.
type Comparison struct {
	Before     Header  `json:"before"`
	After      Header  `json:"after"`
	BusyDelta  float64 `json:"busyDeltaPct"`
	GCDelta    float64 `json:"gcDeltaPct"`
	ByFunction []Delta `json:"byFunction"`
	ByPackage  []Delta `json:"byPackage"`
}

// Compare diffs two rolled-up profiles.
func Compare(before, after CPUAnalysis) Comparison {
	return Comparison{
		Before:     header(before),
		After:      header(after),
		BusyDelta:  after.BusyPct - before.BusyPct,
		GCDelta:    after.GCPct - before.GCPct,
		ByFunction: deltas(before.ByFunction, after.ByFunction),
		ByPackage:  deltas(before.ByPackage, after.ByPackage),
	}
}

func header(a CPUAnalysis) Header {
	return Header{DurationMs: a.DurationMs, Samples: a.Samples, BusyPct: a.BusyPct, GCPct: a.GCPct}
}

// deltas matches rows by name and file, not line: an edit above a function
// moves its line, and the function must still compare with itself.
func deltas(before, after []Row) []Delta {
	byKey := map[string]*Delta{}
	var order []string
	get := func(r Row) *Delta {
		key := r.Name + "\x00" + fileOf(r.Where)
		d, ok := byKey[key]
		if !ok {
			d = &Delta{Name: r.Name}
			byKey[key] = d
			order = append(order, key)
		}
		d.Where = r.Where
		return d
	}
	for _, r := range before {
		d := get(r)
		d.BeforePct += r.Pct
		d.BeforeMs += r.Ms
	}
	for _, r := range after {
		d := get(r)
		d.AfterPct += r.Pct
		d.AfterMs += r.Ms
	}
	out := make([]Delta, 0, len(order))
	for _, k := range order {
		d := byKey[k]
		d.DeltaPct = d.AfterPct - d.BeforePct
		out = append(out, *d)
	}
	sort.SliceStable(out, func(i, j int) bool {
		ai, aj := math.Abs(out[i].DeltaPct), math.Abs(out[j].DeltaPct)
		if ai != aj {
			return ai > aj
		}
		return out[i].Name+out[i].Where < out[j].Name+out[j].Where
	})
	return out
}

// Top is the comparison with each table cut to its first n rows.
func (c Comparison) Top(n int) Comparison {
	c.ByFunction, c.ByPackage = head(c.ByFunction, n), head(c.ByPackage, n)
	return c
}

// fileOf drops the ":line" a function row's Where ends with.
func fileOf(where string) string {
	if i := strings.LastIndex(where, ":"); i > 0 {
		return where[:i]
	}
	return where
}

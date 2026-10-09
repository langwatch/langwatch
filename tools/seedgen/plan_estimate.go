package seedgen

import (
	"fmt"
	"io"
	"maps"
	"slices"
	"time"
)

// Measured by SG5 on a laptop haven stack, 2026-10-09: ClickHouse bytes on disk per row after a tiny
// run (event-log bytes per span: ~5 event rows each), and the task route's S-tier send rate under the
// guard with haven's 512 MB Redis. Postgres row size and actions/s are not measured yet.
const (
	postgresRowBytes  = 1_024
	spanBytes         = 130
	traceSummaryBytes = 160
	logBytes          = 400
	metricPointBytes  = 170
	eventLogRowBytes  = 960
	spansPerTrace     = 5
	spansPerSecond    = 55
	actionsPerSecond  = 20
)

// Estimate is the dry run's answer: counts per kind, rows and bytes per store, expected duration.
type Estimate struct {
	Counts   map[string]int           `json:"counts"`
	Stores   map[string]StoreEstimate `json:"stores"`
	Duration time.Duration            `json:"duration"`
}

// StoreEstimate is one store's expected rows and bytes.
type StoreEstimate struct {
	Rows  int64 `json:"rows"`
	Bytes int64 `json:"bytes"`
}

// Estimate walks the stream without writing anything.
func (p *Plan) Estimate() Estimate {
	counts := map[string]int{"orgs": len(p.Orgs)}
	if p.Flags.Into != "" {
		counts["orgs"] = 0 // --into creates no org
	}
	for step := range p.Steps() {
		if step.Action != nil {
			counts[step.Action.Kind]++
			continue
		}
		counts["cells"]++
		counts["spans"] += step.Cell.Spans
		counts["logs"] += step.Cell.Logs
		counts["metricPoints"] += step.Cell.MetricPoints
	}
	counts["traces"] = (counts["spans"] + spansPerTrace - 1) / spansPerTrace
	actions := 0
	for _, kind := range Kinds {
		actions += counts[kind]
	}
	// a user is a User row and a membership row
	postgres := int64(actions + counts[KindUserCreate])
	spans, traces, logs, points := int64(counts["spans"]), int64(counts["traces"]), int64(counts["logs"]),
		int64(counts["metricPoints"])
	return Estimate{
		Counts: counts,
		Stores: map[string]StoreEstimate{
			"postgres": {Rows: postgres, Bytes: postgres * postgresRowBytes},
			"clickhouse": {Rows: 2*spans + traces + logs + points,
				Bytes: spans*(spanBytes+eventLogRowBytes) + traces*traceSummaryBytes + logs*logBytes + points*metricPointBytes},
		},
		Duration: time.Duration(spans/spansPerSecond+int64(actions/actionsPerSecond)) * time.Second,
	}
}

// Print writes the estimate as the dry run shows it.
func (e Estimate) Print(w io.Writer) {
	_, _ = fmt.Fprintln(w, "counts per kind:")
	for _, kind := range slices.Sorted(maps.Keys(e.Counts)) {
		_, _ = fmt.Fprintf(w, "  %-16s %d\n", kind, e.Counts[kind])
	}
	_, _ = fmt.Fprintln(w, "estimated per store:")
	for _, store := range slices.Sorted(maps.Keys(e.Stores)) {
		_, _ = fmt.Fprintf(w, "  %-16s %d rows, %d MB\n", store, e.Stores[store].Rows, e.Stores[store].Bytes>>20)
	}
	_, _ = fmt.Fprintf(w, "expected duration: %s (estimate)\n", e.Duration)
}

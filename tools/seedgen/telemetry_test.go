package seedgen

import (
	"bytes"
	"encoding/json"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// otlp is the part of an OTLP JSON export request the tests read.
type otlp struct {
	ResourceSpans []struct {
		ScopeSpans []struct {
			Spans []struct{ StartTimeUnixNano, EndTimeUnixNano string }
		}
	}
	ResourceLogs []struct {
		ScopeLogs []struct {
			LogRecords []struct{ TimeUnixNano string }
		}
	}
	ResourceMetrics []struct {
		ScopeMetrics []struct {
			Metrics []json.RawMessage
		}
	}
}

// instants counts the chunk's spans, records or points and returns every time it carries.
func instants(t *testing.T, action Action) (int, []string) {
	t.Helper()
	var doc otlp
	if err := json.Unmarshal(action.Input, &doc); err != nil {
		t.Fatal(err)
	}
	var times []string
	count := 0
	for _, rs := range doc.ResourceSpans {
		for _, ss := range rs.ScopeSpans {
			for _, s := range ss.Spans {
				count++
				times = append(times, s.StartTimeUnixNano, s.EndTimeUnixNano)
			}
		}
	}
	for _, rl := range doc.ResourceLogs {
		for _, sl := range rl.ScopeLogs {
			for _, r := range sl.LogRecords {
				count++
				times = append(times, r.TimeUnixNano)
			}
		}
	}
	for _, rm := range doc.ResourceMetrics {
		for _, sm := range rm.ScopeMetrics {
			for _, m := range sm.Metrics {
				count++
				var point map[string]struct {
					DataPoints []struct{ StartTimeUnixNano, TimeUnixNano string }
				}
				_ = json.Unmarshal(m, &point)
				for _, data := range point {
					for _, p := range data.DataPoints {
						times = append(times, p.TimeUnixNano)
						if p.StartTimeUnixNano != "" {
							times = append(times, p.StartTimeUnixNano)
						}
					}
				}
			}
		}
	}
	return count, times
}

func TestChunksAreBoundedExactAndInsideTheirHour(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny", "--days", "2", "--spans", "40000")
	seen := map[string]bool{}
	for step := range plan.Steps() {
		if step.Cell == nil {
			continue
		}
		cell := step.Cell
		got := map[string]int{}
		for action, err := range plan.Chunks(step) {
			if err != nil {
				t.Fatal(err)
			}
			n, times := instants(t, action)
			got[action.Kind] += n
			if action.Kind == KindTraceOTLP && n > MaxChunkSpans || n > MaxChunkRecords || len(action.Input) > MaxChunkBytes {
				t.Fatalf("%s: %d items, %d bytes", action.ID, n, len(action.Input))
			}
			for _, raw := range times {
				nanos, _ := strconv.ParseInt(raw, 10, 64)
				if at := time.Unix(0, nanos); at.Before(cell.Start) || !at.Before(cell.Start.Add(time.Hour)) {
					t.Fatalf("%s carries %s outside the hour %s", action.ID, at, cell.Start)
				}
			}
			seen[action.Kind] = true
		}
		if got[KindTraceOTLP] != cell.Spans || got[KindLogOTLP] != cell.Logs || got[KindMetricOTLP] != cell.MetricPoints {
			t.Fatalf("cell %s %s: got %v, want %d spans, %d logs, %d points", cell.Project, cell.Start, got,
				cell.Spans, cell.Logs, cell.MetricPoints)
		}
	}
	if len(seen) != 3 {
		t.Errorf("kinds seen: %v", seen)
	}
}

// @scenario "The same seed gives the same logical content"
func TestSameCellAndSeedGiveTheSameChunks(t *testing.T) {
	digest := func(args ...string) []byte {
		plan := mustPlan(t, args...)
		var all bytes.Buffer
		for step := range plan.Steps() {
			for action, err := range plan.Chunks(step) {
				if err != nil {
					t.Fatal(err)
				}
				_ = WriteAction(&all, action)
			}
		}
		return all.Bytes()
	}
	first := digest("--size", "tiny", "--seed", "7")
	if !bytes.Equal(first, digest("--size", "tiny", "--seed", "7")) {
		t.Fatal("the same flags gave different chunks")
	}
	if bytes.Equal(first, digest("--size", "tiny", "--seed", "8")) {
		t.Fatal("another seed gave the same chunks")
	}
}

func TestOnlyOldTraceChunksAreBackdated(t *testing.T) {
	now := anchor
	old := Action{Kind: KindTraceOTLP, At: now.Add(-32 * 24 * time.Hour).Format(time.RFC3339)}
	if !Backdated(old, now) {
		t.Error("a 32-day-old trace chunk is not backdated")
	}
	if Backdated(Action{Kind: KindTraceOTLP, At: now.Add(-30 * 24 * time.Hour).Format(time.RFC3339)}, now) {
		t.Error("a 30-day-old trace chunk is backdated")
	}
	if old.Kind = KindLogOTLP; Backdated(old, now) {
		t.Error("a log chunk is backdated; logs have no past limit")
	}
}

// @scenario "The generator streams instead of holding the plan"
func TestLargePlanWalkStaysUnder256MB(t *testing.T) {
	if testing.Short() {
		t.Skip("walks two million spans")
	}
	plan := mustPlan(t, "--size", "large")
	var stats runtime.MemStats
	chunks, peak := 0, uint64(0)
	for step := range plan.Steps() {
		for _, err := range plan.Chunks(step) {
			if err != nil {
				t.Fatal(err)
			}
			if chunks++; chunks%500 == 0 {
				runtime.ReadMemStats(&stats)
				peak = max(peak, stats.Sys)
			}
		}
	}
	runtime.ReadMemStats(&stats)
	peak = max(peak, stats.Sys)
	t.Logf("%d chunks, peak memory from the OS %d MB", chunks, peak>>20)
	if peak >= 256<<20 {
		t.Fatalf("walking the large plan took %d MB from the OS", peak>>20)
	}
}

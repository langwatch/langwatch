package viewer

import (
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// frame is a terminal big enough that nothing under test is elided by height.
var frame = Frame{Width: 140, Height: 40}

// texts is a body's painted rows, for an assertion that only cares what is on
// screen rather than which line each row came from.
func texts(rows []Row) []string {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.Text)
	}
	return out
}

// @scenario "A Grafana-backed tab says so when the stack is down"
func TestGrafanaTabsSayTheStackIsDown(t *testing.T) {
	traces := &sources.MemoryTraces{Down: true}
	metrics := &sources.MemoryMetrics{Down: true}
	profiles := &sources.MemoryProfiles{Down: true}
	src := Sources{Traces: traces, Metrics: metrics, Profiles: profiles, Now: time.Now}

	cases := []struct {
		name    string
		tab     Tab
		queries func() int
	}{
		{name: "traces", tab: NewTracesTab(src), queries: func() int { return traces.Queries }},
		{name: "metrics", tab: NewMetricsTab(src), queries: func() int { return metrics.Queries }},
		{name: "profiles", tab: NewProfilesTab(src), queries: func() int { return profiles.Queries }},
	}
	for _, tc := range cases {
		t.Run("when "+tc.name+" is selected", func(t *testing.T) {
			tc.tab.Poll()
			body := texts(tc.tab.Body(frame))
			if len(body) != 1 {
				t.Fatalf("body = %d lines, want exactly one", len(body))
			}
			if !strings.Contains(body[0], "observability stack is not running") {
				t.Errorf("body = %q, want it to name the stack as down", body[0])
			}
			if !strings.Contains(body[0], sources.StartObservabilityCommand) {
				t.Errorf("body = %q, want it to name the command that starts it", body[0])
			}
			if got := tc.queries(); got != 0 {
				t.Errorf("%d queries were issued to a stack that is down, want none", got)
			}
		})
	}
}

// tracesFixture is two traces from this worktree, one of them failed.
func tracesFixture() *sources.MemoryTraces {
	now := time.Now()
	return &sources.MemoryTraces{
		RootSpans: []sources.RootSpan{
			{TraceID: "aaa", At: now, Service: "langwatch-app", Name: "POST /api/trace", Duration: 120 * time.Millisecond},
			{TraceID: "bbb", At: now.Add(-time.Minute), Service: "langwatch-worker", Name: "project.batch", Duration: 3 * time.Second, Error: true},
		},
		Trees: map[string][]sources.Span{
			"aaa": {
				{Depth: 0, Name: "POST /api/trace", Service: "langwatch-app", Duration: 120 * time.Millisecond},
				{Depth: 1, Name: "clickhouse.insert", Service: "langwatch-app", Duration: 90 * time.Millisecond},
			},
		},
	}
}

// @scenario "Traces lists this stack's recent root spans"
func TestTracesListsThisStacksRootSpans(t *testing.T) {
	tab := NewTracesTab(Sources{Traces: tracesFixture(), Now: time.Now})
	tab.Poll()
	body := strings.Join(texts(tab.Body(frame)), "\n")
	for _, want := range []string{"langwatch-app", "POST /api/trace", "120ms", "ok", "error"} {
		if !strings.Contains(body, want) {
			t.Errorf("body is missing %q:\n%s", want, body)
		}
	}
	rows, ok := tab.Rows().([]sources.RootSpan)
	if !ok || len(rows) != 2 {
		t.Fatalf("rows = %#v, want the two root spans", tab.Rows())
	}
	if !rows[0].At.After(rows[1].At) {
		t.Error("rows are not newest first")
	}
}

// @scenario "A trace opens as an indented span tree, and in Grafana"
func TestTraceOpensAsATreeAndInGrafana(t *testing.T) {
	var opened string
	tab := NewTracesTab(Sources{
		Traces: tracesFixture(),
		Open:   func(url string) error { opened = url; return nil },
		Now:    time.Now,
	})
	tab.Poll()

	t.Run("when the developer presses enter", func(t *testing.T) {
		if !tab.Key("enter") {
			t.Fatal("enter was not claimed by the traces tab")
		}
		body := texts(tab.Body(frame))
		joined := strings.Join(body, "\n")
		if !strings.Contains(joined, "clickhouse.insert") || !strings.Contains(joined, "90ms") {
			t.Errorf("tree body is missing a span's name, service or duration:\n%s", joined)
		}
		var root, child string
		for _, row := range body {
			if strings.Contains(row, "POST /api/trace") {
				root = row
			}
			if strings.Contains(row, "clickhouse.insert") {
				child = row
			}
		}
		if leading(child) <= leading(root) {
			t.Errorf("child span %q is not indented past its parent %q", child, root)
		}
	})

	t.Run("when the developer presses o", func(t *testing.T) {
		if !tab.Key("o") {
			t.Fatal("o was not claimed by the traces tab")
		}
		if !strings.Contains(opened, "aaa") {
			t.Errorf("opened %q, want the selected trace in Grafana", opened)
		}
	})
}

// leading counts the spaces a rendered row starts with.
func leading(row string) int {
	return len(row) - len(strings.TrimLeft(row, " "))
}

// @scenario "Errors-only toggles the trace list"
func TestErrorsOnlyTogglesTheTraceList(t *testing.T) {
	tab := NewTracesTab(Sources{Traces: tracesFixture(), Now: time.Now})
	tab.Poll()
	if !tab.Key("e") {
		t.Fatal("e was not claimed by the traces tab")
	}
	rows, ok := tab.Rows().([]sources.RootSpan)
	if !ok || len(rows) != 1 || rows[0].TraceID != "bbb" {
		t.Fatalf("rows = %#v, want only the failed trace", tab.Rows())
	}
	tab.Key("e")
	if rows, _ := tab.Rows().([]sources.RootSpan); len(rows) != 2 {
		t.Errorf("rows = %d, want e to toggle back to every trace", len(rows))
	}
}

// @scenario "Metrics is a fixed panel, not a query box"
func TestMetricsIsAFixedPanel(t *testing.T) {
	metrics := &sources.MemoryMetrics{Series: []sources.Series{
		{Label: "request rate", Value: "12.0/s", Samples: []float64{1, 4, 9, 12}},
		{Label: "p95 latency", Value: "180 ms", Samples: []float64{0.1, 0.18}},
		{Label: "queue depth", Value: "3", Samples: []float64{0, 3}},
		{Label: "blocked jobs", Value: "0", Samples: []float64{0, 0}},
		{Label: "ClickHouse statements", Value: "7", Samples: []float64{5, 7}},
		{Label: "lane RSS", Value: "1.2 GB", Samples: []float64{1, 2}},
		{Label: "lane CPU", Value: "0.40 cores", Samples: []float64{0.2, 0.4}},
	}}
	tab := NewMetricsTab(Sources{Metrics: metrics, Now: time.Now})
	tab.Poll()
	body := texts(tab.Body(frame))
	if len(body) != len(metrics.Series) {
		t.Fatalf("body = %d rows, want one per metric (%d)", len(body), len(metrics.Series))
	}
	for i, series := range metrics.Series {
		row := body[i]
		if !strings.Contains(row, series.Label) || !strings.Contains(row, series.Value) {
			t.Errorf("row %d = %q, want the label and the current value", i, row)
		}
		if !strings.Contains(row, Sparkline(series.Samples)) {
			t.Errorf("row %d = %q, want a text sparkline of the window", i, row)
		}
	}

	t.Run("when a key is pressed, the panel claims none of them", func(t *testing.T) {
		for _, k := range []string{"/", "enter", "e", "w"} {
			if tab.Key(k) {
				t.Errorf("the metrics panel claimed %q - it is a panel, not a query box", k)
			}
		}
	})
}

// @scenario "Profiles shows the top functions per service"
func TestProfilesShowsTopFunctionsPerService(t *testing.T) {
	profiles := &sources.MemoryProfiles{Services: []sources.ServiceProfile{
		{Service: "langwatch-app", CPU: entries("app.cpu", 10), Heap: entries("app.heap", 10)},
		{Service: "langwatch-service-nlpgo", CPU: entries("nlp.cpu", 10), Heap: entries("nlp.heap", 10)},
	}}
	var opened string
	tab := NewProfilesTab(Sources{
		Profiles: profiles,
		Open:     func(url string) error { opened = url; return nil },
		Now:      time.Now,
	})
	tab.Poll()
	body := strings.Join(texts(tab.Body(frame)), "\n")
	for _, want := range []string{"CPU", "heap", "app.cpu0", "app.cpu9", "app.heap9"} {
		if !strings.Contains(body, want) {
			t.Errorf("body is missing %q:\n%s", want, body)
		}
	}

	t.Run("when the developer moves to another service and presses o", func(t *testing.T) {
		tab.Key("down")
		if tab.Selected() != "langwatch-service-nlpgo" {
			t.Fatalf("selected = %q, want the second service", tab.Selected())
		}
		if !tab.Key("o") {
			t.Fatal("o was not claimed by the profiles tab")
		}
		if !strings.Contains(opened, "langwatch-service-nlpgo") {
			t.Errorf("opened %q, want the selected service's flame graph", opened)
		}
	})
}

// entries builds one top-ten list with descending shares.
func entries(prefix string, n int) []sources.ProfileEntry {
	out := make([]sources.ProfileEntry, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, sources.ProfileEntry{Function: prefix + itoa(i), Share: float64(n-i) / float64(n)})
	}
	return out
}

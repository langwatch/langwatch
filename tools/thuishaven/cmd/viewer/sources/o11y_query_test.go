package sources

import (
	"strings"
	"testing"
	"time"
)

func TestTraceFilterBuildsWorktreeScopedTraceQL(t *testing.T) {
	tempo := NewTempo(3000, "feat-x")
	got := tempo.filterQL(TraceFilter{Service: "api", Name: "a.b", MinDuration: 500 * time.Millisecond, ErrorsOnly: true})
	for _, want := range []string{
		`resource.langwatch.worktree = "feat-x"`, `resource.service.name = "api"`,
		`name =~ ".*a\\.b.*"`, `traceDuration >= 500ms`, `status = error`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("query %q lacks %q", got, want)
		}
	}
	if (TraceFilter{}).Active() {
		t.Error("the zero filter must not count as a filter")
	}
}

func TestLogQueryIsWorktreeScopedAndCarriesTheFilters(t *testing.T) {
	loki := NewLoki(3000, "feat-x", time.Now())
	got := loki.queryQL(LogQuery{Services: []string{"api"}, Grep: "boom", TraceID: "abc123"})
	for _, want := range []string{`service_name=~".*api.*"`, `|= "boom"`, `langwatch_worktree="feat-x"`, `trace_id="abc123"`} {
		if !strings.Contains(got, want) {
			t.Errorf("query %q lacks %q", got, want)
		}
	}
}

package cell

import (
	"strings"
	"testing"
	"time"
)

func TestRibbonDrawsPhasesMarksAndSteps(t *testing.T) {
	origin := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	report := &Report{Phases: []PhaseChange{{"down", 0}, {"ready", 4000}}, Marks: map[string]int64{"switched": 2000}}
	steps := []LedgerRow{{ID: "pg:a", Started: "2026-10-10 12:00:01+00", Finished: "2026-10-10 12:00:03.5+00"}, {ID: "no-times"}}
	got := Ribbon(report, origin, steps)
	for _, want := range []string{"api down", "api ready", "switched", "step pg:a", "1000-3500"} {
		if !strings.Contains(got, want) {
			t.Errorf("ribbon lacks %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "no-times") {
		t.Errorf("ribbon drew a step without timestamps:\n%s", got)
	}
}

func TestEveryScenarioIDNamesAnInvariantTheReportKnows(t *testing.T) {
	for id := range scenarioIDs {
		if invariantNames[id] == "" {
			t.Errorf("scenarioIDs names %s, which invariantNames does not know", id)
		}
	}
}

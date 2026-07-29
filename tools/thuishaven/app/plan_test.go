package app

import (
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// A red prefix reads as an error even on an ordinary info log, so red (ANSI 31)
// is reserved for genuine failures and no supervised lane may use it. The workers
// lane in particular used to be red; this pins it (and every other lane) green-or-
// other, never red.
func TestNoLaneIsRed(t *testing.T) {
	const red = "31"
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}}

	children := o.planChildren(
		domain.Stack{Slug: "test"},
		PlanOptions{ShouldStartWorkers: true},
		t.TempDir(),
	)

	var sawWorkers bool
	for _, c := range children {
		if c.Color == red {
			t.Errorf("lane %q uses red (ANSI %s); red is reserved for real errors", c.Name, red)
		}
		if c.Name == "workers" {
			sawWorkers = true
		}
	}
	if !sawWorkers {
		t.Fatal("expected a workers lane in the plan")
	}
}

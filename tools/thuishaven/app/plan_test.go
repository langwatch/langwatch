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
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}

	children := o.planChildren(
		domain.Stack{Slug: "test"},
		PlanOptions{ShouldStartWorkers: true},
		t.TempDir(),
		"", // langyDockerHost — not exercised here; the langy lane isn't under test
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

// stubProxy satisfies app.Proxy for planChildren, which reads only CACertPath().
// "" means "no portless CA present", so no NODE_EXTRA_CA_CERTS is appended.
type stubProxy struct{}

func (stubProxy) Register(string, string, int) error { return nil }
func (stubProxy) Remove(string, string)              {}
func (stubProxy) Running() bool                      { return false }
func (stubProxy) Installed() bool                    { return false }
func (stubProxy) EnsureReady() error                 { return nil }
func (stubProxy) Endpoint() (string, int)            { return "https", 443 }
func (stubProxy) CACertPath() string                 { return "" }

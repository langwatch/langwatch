package app

import (
	"strings"
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
		PlanOptions{Selection: domain.Selection{Gateway: true, NLP: true}},
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
func (stubProxy) Shutdown() error                    { return nil }
func (stubProxy) Install() error                     { return nil }

// The three Node lanes are the whole application, so all three are planned
// unconditionally and each runs its own package's `dev` script from the
// workspace root. Nothing selects them and no environment variable moves work
// between them: a stack that planned two of the three would boot, serve pages,
// and quietly process no jobs.
//
// @scenario "Every stack runs the three Node lanes"
func TestTheThreeNodeLanesAlwaysRun(t *testing.T) {
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	repo := t.TempDir()
	children := o.planChildren(domain.Stack{Slug: "test"}, PlanOptions{Selection: domain.Selection{}}, repo, "")

	find := func(name string) (Child, bool) {
		for _, c := range children {
			if c.Name == name {
				return c, true
			}
		}
		return Child{}, false
	}

	for lane, pkg := range map[string]string{"ui": UIPackage, "api": APIPackage, "workers": WorkerPackage} {
		child, ok := find(lane)
		if !ok {
			t.Fatalf("no %q lane was planned; every stack runs all three", lane)
		}
		if !strings.Contains(child.Shell, pkg) {
			t.Errorf("%s lane runs %q, want it to filter %s", lane, child.Shell, pkg)
		}
		if child.Dir != repo {
			t.Errorf("%s lane runs in %q, want the workspace root %q", lane, child.Dir, repo)
		}
		for _, e := range child.Env {
			if strings.HasPrefix(e, "WORKERS_IN_PROCESS=") || strings.HasPrefix(e, "START_WORKERS=") {
				t.Errorf("%s lane still carries %q; neither variable is read any more", lane, e)
			}
		}
	}
}

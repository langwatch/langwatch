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

	var sawBackend bool
	for _, c := range children {
		if c.Color == red {
			t.Errorf("lane %q uses red (ANSI %s); red is reserved for real errors", c.Name, red)
		}
		if c.Name == BackendLane {
			sawBackend = true
		}
	}
	if !sawBackend {
		t.Fatal("expected a backend lane in the plan")
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
func (stubProxy) Version() string                    { return domain.PortlessVersion }

// The two Node lanes are the whole application, so both are planned
// unconditionally: ui, and the backend that hosts the API application and the
// worker application in one local process (ADR-004, amendment 2026-09-07).
// Nothing selects them and no environment variable moves work between them: a
// stack that planned only the ui lane would boot, serve pages, and quietly
// process no jobs.
//
// @scenario "Every stack runs the ui and backend lanes"
func TestTheTwoNodeLanesAlwaysRun(t *testing.T) {
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

	for lane, pkg := range map[string]string{"ui": UIPackage, BackendLane: BackendPackage} {
		child, ok := find(lane)
		if !ok {
			t.Fatalf("no %q lane was planned; every stack runs both", lane)
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
	// The worker is not a lane of its own any more, and neither is the api.
	for _, gone := range []string{"api", "workers"} {
		if _, found := find(gone); found {
			t.Errorf("a %q lane was planned; both run inside the backend lane now", gone)
		}
	}
}

// One Go process, hosting whichever data-plane services the stack selected,
// each on the port haven allocated for its hostname. SERVER_ADDR cannot name
// two listeners in one process, so each service gets its own address variable.
//
// @scenario "The Go data-plane services share one lane"
func TestTheGoServicesSharePlanOneLane(t *testing.T) {
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	repo := t.TempDir()
	st := domain.Stack{Slug: "test", Services: []domain.Service{
		{Name: "gateway", Port: 44003},
		{Name: "nlp", Port: 44001},
	}}
	children := o.planChildren(st, PlanOptions{
		RepoRoot:  repo,
		Selection: domain.Selection{Gateway: true, NLP: true},
	}, repo, "")

	var lane *Child
	for i := range children {
		if children[i].Name == GoLane {
			lane = &children[i]
		}
		if children[i].Name == "gateway" || children[i].Name == "nlp" {
			t.Errorf("%q is still its own lane; both run in the go lane now", children[i].Name)
		}
	}
	if lane == nil {
		t.Fatal("no go lane was planned for a stack selecting gateway and nlp")
	}
	if !strings.Contains(lane.Shell, "svc=combined") {
		t.Errorf("go lane runs %q, want the combined mono-binary subcommand", lane.Shell)
	}
	for _, want := range []string{GatewayAddrEnv + "=:44003", NLPAddrEnv + "=:44001"} {
		found := false
		for _, e := range lane.Env {
			if e == want {
				found = true
			}
		}
		if !found {
			t.Errorf("go lane env %v is missing %q", lane.Env, want)
		}
		if strings.HasPrefix(want, "SERVER_ADDR") {
			t.Error("SERVER_ADDR cannot address two listeners in one process")
		}
	}
}

// A worktree that turned one of them off gets a process hosting only the other,
// not a lane it has to reason about and not a second process.
//
// @scenario "A deselected Go service is simply not hosted"
func TestTheGoLaneHostsOnlyWhatWasSelected(t *testing.T) {
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	repo := t.TempDir()
	st := domain.Stack{Slug: "test", Services: []domain.Service{{Name: "gateway", Port: 44003}}}
	children := o.planChildren(st, PlanOptions{
		RepoRoot:  repo,
		Selection: domain.Selection{Gateway: true},
	}, repo, "")

	for _, c := range children {
		if c.Name != GoLane {
			continue
		}
		if strings.Contains(c.Shell, "nlpgo") {
			t.Errorf("go lane runs %q, but nlp was not selected", c.Shell)
		}
		for _, e := range c.Env {
			if strings.HasPrefix(e, NLPAddrEnv+"=") {
				t.Errorf("go lane carries %q, but nlp was not selected", e)
			}
		}
		return
	}
	t.Fatal("no go lane was planned for a stack selecting the gateway")
}

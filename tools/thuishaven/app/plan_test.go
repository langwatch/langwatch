package app

import (
	"encoding/json"
	"os"
	"path/filepath"
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
		PlanOptions{Selection: domain.Selection{Workers: true, Gateway: true, NLP: true}},
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

// Every Node lane has to run its entry point FROM SOURCE. The bundle entries
// (`start:app`, `start:workers` -> node dist/server/*.cjs) belong to the
// production image; nothing in a worktree builds dist/, so a lane pointed at one
// crashlooped on MODULE_NOT_FOUND from the first `haven up` on a fresh checkout.
//
// This reads the real package.json rather than comparing the shell string to a
// copy of itself: the failure it guards is a lane naming a script that does not
// exist, or one that resolves to a build artifact. Renaming `start:app:dev`
// without updating haven fails here.
//
// @scenario "A fresh checkout needs no build before its lanes start"
func TestNodeLanesRunFromSource(t *testing.T) {
	scripts := appPackageScripts(t)
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	children := o.planChildren(
		domain.Stack{Slug: "test"},
		PlanOptions{Selection: domain.Selection{Workers: true, Gateway: true, NLP: true}},
		t.TempDir(),
		"",
	)

	var checked int
	for _, c := range children {
		script, ok := strings.CutPrefix(c.Shell, "pnpm -s run ")
		if !ok {
			continue // a Go lane (make service ...) or the langy container lane
		}
		checked++
		body, defined := scripts[script]
		if !defined {
			t.Errorf("lane %q runs %q, which platform/app/package.json does not define", c.Name, script)
			continue
		}
		if strings.Contains(body, "dist/") {
			t.Errorf("lane %q runs %q = %q, a pre-built bundle; a worktree never builds dist/, so the lane crashloops on MODULE_NOT_FOUND", c.Name, script, body)
		}
	}
	if checked == 0 {
		t.Fatal("no Node lane was planned, so this pinned nothing")
	}
}

// appPackageScripts reads the app's package.json scripts map. The test binary
// runs in its own package directory, so the path is relative to that.
func appPackageScripts(t *testing.T) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "platform", "app", "package.json"))
	if err != nil {
		t.Fatalf("reading the app package.json: %v", err)
	}
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatalf("parsing the app package.json: %v", err)
	}
	return pkg.Scripts
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

// The standalone lane is chosen by the selection alone. There is no env-var
// escape beside it: `Selection.Workers` picks the lane, its absence means the
// app process hosts the worker stack itself, and nothing turns the worker
// stack off entirely.
//
// @scenario "The standalone workers lane is a selection, not an env var"
func TestWorkersLaneFollowsTheSelection(t *testing.T) {
	plan := func(sel domain.Selection) []Child {
		o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
		return o.planChildren(domain.Stack{Slug: "test"}, PlanOptions{Selection: sel}, t.TempDir(), "")
	}
	find := func(children []Child, name string) (Child, bool) {
		for _, c := range children {
			if c.Name == name {
				return c, true
			}
		}
		return Child{}, false
	}
	hasEnv := func(c Child, want string) bool {
		for _, e := range c.Env {
			if e == want {
				return true
			}
		}
		return false
	}

	t.Run("given a selection without the workers lane", func(t *testing.T) {
		children := plan(domain.DefaultSelection())

		t.Run("when the stack is planned", func(t *testing.T) {
			t.Run("runs no separate workers lane", func(t *testing.T) {
				if _, ok := find(children, "workers"); ok {
					t.Error("a lane was planned for a selection that did not ask for one")
				}
			})
			t.Run("hosts the worker stack in the app process instead", func(t *testing.T) {
				api, ok := find(children, "api")
				if !ok {
					t.Fatal("no api child was planned")
				}
				if !hasEnv(api, "WORKERS_IN_PROCESS=1") {
					t.Errorf("api env %v lacks WORKERS_IN_PROCESS=1, so nothing would run the workers", api.Env)
				}
			})
		})
	})

	t.Run("given a selection with the workers lane", func(t *testing.T) {
		children := plan(domain.Selection{Workers: true})

		t.Run("when the stack is planned", func(t *testing.T) {
			t.Run("runs the workers as their own lane", func(t *testing.T) {
				if _, ok := find(children, "workers"); !ok {
					t.Error("no workers lane was planned for a selection that asked for one")
				}
			})
			t.Run("stops the app process from hosting them too", func(t *testing.T) {
				api, ok := find(children, "api")
				if !ok {
					t.Fatal("no api child was planned")
				}
				if hasEnv(api, "WORKERS_IN_PROCESS=1") {
					t.Error("the app would host the workers as well as the lane, running them twice")
				}
			})
		})
	})
}

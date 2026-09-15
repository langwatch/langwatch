package app

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// A monolith stack as haven records it: the same routed hostnames and the same
// allocated ports as any other stack, with the layout that decides which
// processes sit behind them.
func monolithStack() domain.Stack {
	return domain.Stack{
		Slug: "apidiff-run-base", Layout: domain.LayoutMonolith, APIPort: 46001,
		Services: []domain.Service{
			{Name: "app", Port: 46000},
			{Name: "gateway", Port: 46003},
			{Name: "nlp", Port: 46004},
		},
	}
}

// planMonolith plans a monolith stack's children with no process started and
// nothing on disk but the two temporary directories.
func planMonolith(t *testing.T, sel domain.Selection) (children []Child, repo string) {
	t.Helper()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	repo = t.TempDir()
	return o.planChildren(monolithStack(), PlanOptions{RepoRoot: repo, Selection: sel}, repo, ""), repo
}

// One process serves the browser application and its API in that checkout, so
// the stack has one Node lane. Planning a ui or a backend lane there would run
// `pnpm --filter` against packages the checkout does not contain.
//
// @scenario "The monolith plan is one Node lane"
func TestMonolithPlansOneNodeLane(t *testing.T) {
	t.Run("given a monolith stack", func(t *testing.T) {
		t.Run("when its children are planned, the one Node lane is app", func(t *testing.T) {
			children, repo := planMonolith(t, domain.Selection{})

			app, ok := findChild(children, domain.MonolithAppLane)
			if !ok {
				t.Fatalf("no %q lane was planned; children were %v", domain.MonolithAppLane, children)
			}
			if !strings.Contains(app.Shell, domain.MonolithPackage) || !strings.Contains(app.Shell, "dev:app") {
				t.Errorf("app lane runs %q, want the monolith package's own dev:app script", app.Shell)
			}
			if app.Dir != repo {
				t.Errorf("app lane runs in %q, want the workspace root %q", app.Dir, repo)
			}
			for _, gone := range []string{"ui", BackendLane} {
				if _, found := findChild(children, gone); found {
					t.Errorf("a %q lane was planned; that package does not exist in this checkout", gone)
				}
			}
		})
	})
}

// PORT is what that checkout derives its own local ports from, and the API
// port is the one haven routes /api to. Both are haven's numbers, or a
// listener lands where nothing is routed.
//
// @scenario "The app lane is handed the ports haven allocated"
func TestMonolithAppLaneGetsTheAllocatedPorts(t *testing.T) {
	t.Run("given a monolith stack whose app hostname and API port are allocated", func(t *testing.T) {
		t.Run("when the app lane is planned, it carries both ports", func(t *testing.T) {
			children, _ := planMonolith(t, domain.Selection{})
			app, _ := findChild(children, domain.MonolithAppLane)

			for _, want := range []string{"PORT=46000", "LANGWATCH_API_PORT=46001"} {
				if !hasEnv(app.Env, want) {
					t.Errorf("app lane env %v is missing %q", app.Env, want)
				}
			}
		})
	})
}

// That checkout's start script fans out and starts its own gateway and NLP
// engine on ports derived from PORT. haven allocated a port for each of those
// hostnames and starts them itself, so the lane is told not to.
//
// @scenario "The app lane leaves the Go services to haven"
func TestMonolithAppLaneLeavesTheGoServicesToHaven(t *testing.T) {
	t.Run("given a monolith stack that also runs the Go services", func(t *testing.T) {
		t.Run("when the children are planned, haven owns both Go services", func(t *testing.T) {
			children, _ := planMonolith(t, domain.Selection{Gateway: true, NLP: true})

			app, _ := findChild(children, domain.MonolithAppLane)
			for _, want := range []string{"LANGWATCH_SKIP_AIGATEWAY=1", "LANGWATCH_SKIP_NLP=1"} {
				if !hasEnv(app.Env, want) {
					t.Errorf("app lane env %v is missing %q, so it starts a second listener", app.Env, want)
				}
			}
			for lane, addr := range map[string]string{"gateway": "SERVER_ADDR=:46003", "nlp": "SERVER_ADDR=:46004"} {
				child, ok := findChild(children, lane)
				if !ok {
					t.Fatalf("no %q child was planned; that checkout hosts no combined Go process", lane)
				}
				if !hasEnv(child.Env, addr) {
					t.Errorf("%s env %v is missing %q", lane, child.Env, addr)
				}
				if strings.Contains(child.Shell, "combined") {
					t.Errorf("%s runs %q, which that checkout's mono-binary does not define", lane, child.Shell)
				}
				if strings.Contains(child.Shell, "service-watch") {
					t.Errorf("%s runs %q, which refuses to start without a dotenv file in the package", lane, child.Shell)
				}
			}
			if _, found := findChild(children, GoLane); found {
				t.Error("a combined go lane was planned; that checkout cannot host one")
			}
		})
	})
}

// @scenario "The app lane writes its own log capture"
func TestMonolithAppLaneCapturesItsOwnLog(t *testing.T) {
	t.Run("given a monolith stack", func(t *testing.T) {
		t.Run("when the app lane is planned, its output is captured as the app log", func(t *testing.T) {
			o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
			repo := t.TempDir()
			st := monolithStack()
			children := o.planChildren(st, PlanOptions{RepoRoot: repo}, repo, "")

			app, _ := findChild(children, domain.MonolithAppLane)
			want := filepath.Join(o.cfg.Home, "logs", st.Slug, "app.log")
			if app.LogPath != want {
				t.Errorf("app lane captures to %q, want %q, which `haven logs app` reads", app.LogPath, want)
			}
		})
	})
}

// On a modular stack the ui lane waits for the API. Here they are the same
// process, so a probe would hold the lane until the lane started.
//
// @scenario "The app lane does not wait on itself"
func TestMonolithAppLaneDoesNotWaitOnItself(t *testing.T) {
	t.Run("given a monolith stack whose one lane serves both halves", func(t *testing.T) {
		t.Run("when the app lane is planned, it starts immediately", func(t *testing.T) {
			children, _ := planMonolith(t, domain.Selection{})
			app, _ := findChild(children, domain.MonolithAppLane)
			if app.ReadyProbeURL != "" {
				t.Errorf("app lane waits for %q, which is itself", app.ReadyProbeURL)
			}
		})
	})
}

// @scenario "The Go services wait for the health path"
func TestMonolithGoServicesWaitForTheHealthPath(t *testing.T) {
	t.Run("given a monolith stack that also runs the Go services", func(t *testing.T) {
		t.Run("when they are planned, each waits for the health path", func(t *testing.T) {
			children, _ := planMonolith(t, domain.Selection{Gateway: true, NLP: true})
			want := "http://127.0.0.1:46001/api/health"

			for _, lane := range []string{"gateway", "nlp"} {
				child, _ := findChild(children, lane)
				if child.ReadyProbeURL != want {
					t.Errorf("%s waits for %q, want the health path on the allocated API port %q", lane, child.ReadyProbeURL, want)
				}
			}
		})
	})
}

// The database preparation script belongs to the monolith package there: its
// workspace root defines no start:prepare:db, so the root command would fail
// with "command not found" before a single migration ran.
//
// @scenario "Migrations run under the monolith's own script"
func TestMonolithMigrationsRunUnderItsOwnScript(t *testing.T) {
	t.Run("given a monolith checkout", func(t *testing.T) {
		t.Run("when the one-shot jobs are resolved, migrations run through the package", func(t *testing.T) {
			jobs := prepShellsFor(domain.LayoutMonolith)
			if !strings.Contains(jobs.Prepare, domain.MonolithPackage) || !strings.Contains(jobs.Prepare, "start:prepare:db") {
				t.Errorf("migration job is %q, want the monolith package's own script", jobs.Prepare)
			}
			if jobs.Seed == "" {
				t.Error("no seed job was resolved; that checkout defines the same seed script at its root")
			}
			if modular := prepShellsFor(domain.LayoutModular); modular.Prepare != prepareDBShell {
				t.Errorf("a modular checkout's migration job changed to %q", modular.Prepare)
			}
		})
	})
}

// @scenario "Codegen is left to the app lane, which runs it itself"
func TestMonolithPlansNoCodegenJob(t *testing.T) {
	t.Run("given a monolith checkout", func(t *testing.T) {
		t.Run("when the one-shot jobs are resolved, there is no codegen job", func(t *testing.T) {
			if got := prepShellsFor(domain.LayoutMonolith).Codegen; got != "" {
				t.Errorf("codegen job is %q; the app lane runs the same codegen on its way up", got)
			}
			if got := prepShellsFor(domain.LayoutModular).Codegen; got == "" {
				t.Error("a modular checkout lost its codegen job")
			}
		})
	})
}

// hasEnv reports whether a child's environment carries an exact KEY=VALUE line.
func hasEnv(env []string, want string) bool {
	for _, e := range env {
		if e == want {
			return true
		}
	}
	return false
}

// monolithStatusJSON is the shape a run script reads to decide a monolith
// stack is up: the layout, and the lanes that layout actually has.
type monolithStatusJSON struct {
	Stacks []struct {
		Slug   string `json:"slug"`
		Layout string `json:"layout"`
		Lanes  []struct {
			Name      string `json:"name"`
			Port      int    `json:"port"`
			Listening bool   `json:"listening"`
		} `json:"lanes"`
	} `json:"stacks"`
}

// A script polling for readiness has to know which lanes to wait for, and on a
// monolith stack `ui` and `backend` never appear. Both answers travel in the
// same report: the layout, and the one lane it has.
//
// @scenario "Status reports the layout and the single app lane"
func TestStatusJSONReportsTheMonolithLayoutAndItsLane(t *testing.T) {
	t.Run("given a monolith stack on record", func(t *testing.T) {
		t.Run("when status is read as JSON, it names the layout and the app lane", func(t *testing.T) {
			st := monolithStack()
			st.LauncherPID = 42
			store := &fakeStore{stacks: []domain.Stack{st}}
			sys := &fakeSystem{alive: map[int]bool{42: true}, portsInUse: map[int]bool{46000: true}}
			o := statusOrch(store, sys)

			out := captureStdout(t, func() {
				if err := o.Status(true, ""); err != nil {
					t.Fatalf("status: %v", err)
				}
			})

			var got monolithStatusJSON
			if err := json.Unmarshal([]byte(out), &got); err != nil {
				t.Fatalf("status --json is not valid JSON: %v\n%s", err, out)
			}
			if len(got.Stacks) != 1 {
				t.Fatalf("stacks = %v, want the monolith stack listed", got.Stacks)
			}
			reported := got.Stacks[0]
			if reported.Layout != string(domain.LayoutMonolith) {
				t.Errorf("layout = %q, want %q", reported.Layout, domain.LayoutMonolith)
			}
			if len(reported.Lanes) != 1 {
				t.Fatalf("lanes = %v, want exactly one", reported.Lanes)
			}
			lane := reported.Lanes[0]
			if lane.Name != domain.MonolithAppLane || lane.Port != 46000 || !lane.Listening {
				t.Errorf("lane = %+v, want the app lane on the routed port, listening", lane)
			}
		})
	})
}

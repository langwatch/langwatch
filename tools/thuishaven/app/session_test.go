package app

import (
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func findService(r SessionReport, name string) (SessionServiceStatus, bool) {
	for _, s := range r.Services {
		if s.Name == name {
			return s, true
		}
	}
	return SessionServiceStatus{}, false
}

func hasServer(r SessionReport, name string) bool {
	for _, s := range r.Servers {
		if s.Name == name {
			return true
		}
	}
	return false
}

// @scenario "The dashboard reports every service and shared server"
func TestSessionSnapshot(t *testing.T) {
	st := domain.Stack{
		Slug: "feat-x", Branch: "feat/x", LauncherPID: 42, RedisDB: 3,
		APIPort:                  9100,
		WorkerMetricsPort:        9101,
		ClickHouseHTTPPort:       8123,
		ClickHouseDatabase:       "lw_feat_x",
		PostgresPort:             5432,
		PostgresDatabase:         "lw_feat_x",
		RedisPort:                6379,
		ObservabilityGrafanaPort: 3000,
		Services: []domain.Service{
			{Name: "app", Port: 9000, URL: "https://app.feat-x.langwatch.localhost"},
			{Name: "langyagent", Port: 9003, URL: "https://langyagent.feat-x.langwatch.localhost"},
			{Name: "nlp", Port: 9002, IsFallback: true},
		},
	}
	store := &fakeStore{stacks: []domain.Stack{st}, slugCache: map[string]string{}}
	sys := &fakeSystem{alive: map[int]bool{42: true}}
	o := restartOrch(store, sys)

	t.Run("given a live registered stack", func(t *testing.T) {
		r := o.SessionSnapshot("feat-x")
		if !r.Found || !r.Live {
			t.Fatalf("a live registered stack must report found+live, got %+v", r)
		}
		if r.Branch != "feat/x" {
			t.Errorf("branch = %q, want feat/x", r.Branch)
		}

		// The routed hostname is app.<slug>, but the PROCESS on that port is the
		// browser application's lane, and `haven restart`/`haven logs` name it
		// ui. The dashboard has to agree with them or the bounce it offers is
		// spelled differently from the one that works.
		t.Run("when a routed child is ours, it is restartable under its lane name", func(t *testing.T) {
			ui, ok := findService(r, "ui")
			if !ok || !ui.Restartable || ui.Fallback {
				t.Errorf("ui should be a restartable, non-fallback service, got %+v (ok=%v)", ui, ok)
			}
			if _, wrong := findService(r, "app"); wrong {
				t.Error("the routed hostname's internal name must not be offered as a lane")
			}
		})

		t.Run("when a service is langyagent, it is reported in CLI spelling", func(t *testing.T) {
			langy, ok := findService(r, "langy")
			if !ok || !langy.Restartable {
				t.Errorf("langyagent must surface as a restartable langy row, got %+v (ok=%v)", langy, ok)
			}
			if _, wrong := findService(r, "langyagent"); wrong {
				t.Error("the internal langyagent name must never leak to the dashboard")
			}
		})

		t.Run("when a service is a shared baseline's copy, it is not restartable", func(t *testing.T) {
			nlp, ok := findService(r, "nlp")
			if !ok || !nlp.Fallback || nlp.Restartable {
				t.Errorf("a fallback nlp must be flagged shared and non-restartable, got %+v (ok=%v)", nlp, ok)
			}
		})

		t.Run("when the stack uses managed servers, each is reported", func(t *testing.T) {
			for _, name := range []string{"proxy", "daemon", "clickhouse", "postgres", "redis", "observability"} {
				if !hasServer(r, name) {
					t.Errorf("shared machinery %q must be reported, servers=%+v", name, r.Servers)
				}
			}
		})
	})

	t.Run("given no such stack is registered", func(t *testing.T) {
		t.Run("when snapshotting, it reports not-found without a crash", func(t *testing.T) {
			r := o.SessionSnapshot("ghost")
			if r.Found {
				t.Errorf("an unregistered slug must report not-found, got %+v", r)
			}
			if r.Dashboard == "" {
				t.Error("the shared dashboard URL should still resolve for a not-found stack")
			}
		})
	})
}

// @scenario "The dashboard reports every service and shared server"
func TestSessionSnapshotReportsTheWorkerHalfOnItsOwn(t *testing.T) {
	st := domain.Stack{
		Slug: "feat-x", Branch: "feat/x", LauncherPID: 42,
		APIPort:           9100,
		WorkerMetricsPort: 9101,
		Services: []domain.Service{
			{Name: "app", Port: 9000, URL: "https://app.feat-x.langwatch.localhost"},
		},
	}
	store := &fakeStore{stacks: []domain.Stack{st}, slugCache: map[string]string{}}
	// The API port answers and the worker's metrics port does not: a stack that
	// serves pages and processes no jobs, which is the state every other row
	// reports as healthy.
	sys := &fakeSystem{alive: map[int]bool{42: true}, portsInUse: map[int]bool{9000: true, 9100: true}}
	o := restartOrch(store, sys)

	r := o.SessionSnapshot("feat-x")

	worker, ok := findService(r, "worker")
	if !ok {
		t.Fatal("the worker half has no row; a stack processing no jobs would look healthy")
	}
	if worker.Up {
		t.Error("worker.Up = true, want false — its metrics port is not answering")
	}
	if worker.URL != "" {
		t.Errorf("worker.URL = %q, want none — the worker serves no browser traffic", worker.URL)
	}
	if worker.Port != 9101 {
		t.Errorf("worker.Port = %d, want the metrics listener 9101", worker.Port)
	}
	if api, ok := findService(r, "api"); !ok || !api.Up {
		t.Error("the api half must still report up — only the worker is down")
	}
}

// @scenario "The dashboard reports every service and shared server"
// @scenario "One list, and everything in it can be selected"
func TestSessionSnapshotListsSharedMachineryOnceAndSelectably(t *testing.T) {
	st := domain.Stack{
		Slug: "feat-x", Branch: "feat/x", LauncherPID: 42,
		APIPort: 9100, WorkerMetricsPort: 9101,
		PostgresPort: 5432, PostgresDatabase: "lw_feat_x",
		Services: []domain.Service{
			{Name: "app", Port: 9000, URL: "https://app.feat-x.langwatch.localhost"},
			// The same server this stack merely routes to, as a routed name.
			{Name: domain.PostgresService, Port: 5432, URL: "https://postgres.feat-x.langwatch.localhost"},
		},
	}
	store := &fakeStore{stacks: []domain.Stack{st}, slugCache: map[string]string{}}
	sys := &fakeSystem{alive: map[int]bool{42: true}, portsInUse: map[int]bool{5432: true}}
	o := restartOrch(store, sys)

	r := o.SessionSnapshot("feat-x")

	var postgres int
	for _, svc := range r.Services {
		if svc.Name == domain.PostgresService {
			postgres++
		}
	}
	if postgres != 1 {
		t.Errorf("postgres appears %d times in the one selectable list, want once", postgres)
	}
	row, ok := findService(r, domain.PostgresService)
	if !ok {
		t.Fatal("shared machinery must be in the list the dashboard can select from")
	}
	if !row.Shared {
		t.Error("the shared row must say so, or it reads as a child this stack can bounce")
	}
	if row.Restartable {
		t.Error("machine-wide machinery must never be bounceable from one stack")
	}
	if row.Detail == "" {
		t.Error("a row with no URL of its own must still say where it is")
	}
}

// @scenario "The dashboard reports every service and shared server"
// @scenario "One list, and everything in it can be selected"
func TestSessionSnapshotLeadsWithTheTwoNodeLanes(t *testing.T) {
	// The browser application and the API are what a person came to look at,
	// and the worker is the half whose silence is hardest to notice. They lead
	// the list; the machinery this stack merely leans on comes last.
	st := domain.Stack{
		Slug: "feat-x", LauncherPID: 42,
		APIPort: 9100, WorkerMetricsPort: 9101, PostgresPort: 5432,
		Services: []domain.Service{
			{Name: "app", Port: 9000, URL: "https://app.feat-x.langwatch.localhost"},
			{Name: "idp", Port: 9004, URL: "https://idp.feat-x.langwatch.localhost"},
		},
	}
	store := &fakeStore{stacks: []domain.Stack{st}, slugCache: map[string]string{}}
	o := restartOrch(store, &fakeSystem{alive: map[int]bool{42: true}})

	r := o.SessionSnapshot("feat-x")

	if len(r.Services) < 3 {
		t.Fatalf("services = %d, want at least ui, api and worker", len(r.Services))
	}
	lead := []string{r.Services[0].Name, r.Services[1].Name, r.Services[2].Name}
	if lead[0] != "ui" || lead[1] != APILane || lead[2] != WorkerLane {
		t.Errorf("list leads with %v, want ui, api, worker", lead)
	}
	if last := r.Services[len(r.Services)-1]; !last.Shared {
		t.Errorf("list ends with %q, want the machine-wide machinery last", last.Name)
	}
}

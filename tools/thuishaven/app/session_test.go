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

		t.Run("when a routed child is ours, it is restartable", func(t *testing.T) {
			app, ok := findService(r, "app")
			if !ok || !app.Restartable || app.Fallback {
				t.Errorf("app should be a restartable, non-fallback service, got %+v (ok=%v)", app, ok)
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

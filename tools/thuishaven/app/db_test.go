package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type fakeSupervisor struct {
	shells []string
	envs   [][]string
	err    error
	// errOn, when non-empty, fails only the shell containing this substring —
	// so a test can break the seed while letting the prepare pass.
	errOn string
}

func (f *fakeSupervisor) RunOnce(_ context.Context, _, _, shell string, env []string) error {
	f.shells = append(f.shells, shell)
	f.envs = append(f.envs, env)
	if f.errOn != "" {
		if strings.Contains(shell, f.errOn) {
			return f.err
		}
		return nil
	}
	return f.err
}
func (f *fakeSupervisor) RunOnceBounded(_ context.Context, _, _, shell string, env []string, _ ReapLimits) error {
	return f.RunOnce(context.Background(), "", "", shell, env)
}
func (f *fakeSupervisor) Supervise(context.Context, []Child) {}

type portSystem struct {
	fakeSystem
	portsUp map[int]bool
}

func (p *portSystem) PortInUse(port int) bool { return p.portsUp[port] }

func dbOrchestrator(sup *fakeSupervisor, store *fakeStore, sys System, ch, pg *fakeDBServer) *Orchestrator {
	return &Orchestrator{
		cfg: Config{
			Naming: domain.DefaultNaming(""), LocalAPIKey: "sk-lw-local-development-key",
			ShouldManageClickHouse: true, ShouldManagePostgres: true,
		},
		sup: sup, store: store, sys: sys, ch: ch, pg: pg, proxy: &fakeProxy{},
		log: zap.NewNop(),
	}
}

func liveStackStore() *fakeStore {
	return &fakeStore{stacks: []domain.Stack{{
		Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: 42,
		PostgresPort: 1, PostgresDatabase: "lw_feat_x",
		Services: []domain.Service{{Name: "app", Port: 5560}},
	}}}
}

// @scenario "Fresh data is an explicit, confirmed noun"
// @scenario "The default seed is unchanged"
// @scenario "The demo preset needs the stack for its traces"
func TestDBReset(t *testing.T) {
	params := UpParams{ExplicitSlug: "feat-x", WorktreeDir: "/wt/feat-x", LwDir: "/wt/feat-x/langwatch"}

	t.Run("given managed databases and no demo", func(t *testing.T) {
		sup := &fakeSupervisor{}
		ch, pg := &fakeDBServer{}, &fakeDBServer{}
		o := dbOrchestrator(sup, &fakeStore{}, &fakeSystem{}, ch, pg)

		t.Run("when resetting, both databases are dropped then migrated and seeded", func(t *testing.T) {
			if err := o.DBReset(context.Background(), params, DBResetOptions{}); err != nil {
				t.Fatalf("DBReset: %v", err)
			}
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_feat_x" {
				t.Errorf("clickhouse dropped = %v, want lw_feat_x", ch.dropped)
			}
			if len(pg.dropped) != 1 || pg.dropped[0] != "lw_feat_x" {
				t.Errorf("postgres dropped = %v, want lw_feat_x", pg.dropped)
			}
			if len(sup.shells) != 2 {
				t.Fatalf("shells = %v, want prepare then seed", sup.shells)
			}
			if !strings.Contains(sup.shells[0], "start:prepare:db") {
				t.Errorf("shells[0] = %q, want the migrations", sup.shells[0])
			}
			if !strings.Contains(sup.shells[1], "prisma:seed") {
				t.Errorf("shells[1] = %q, want the seed", sup.shells[1])
			}
			joined := strings.Join(sup.envs[1], " ")
			if !strings.Contains(joined, "HAVEN_SEED_LANGWATCH_API_KEY=sk-lw-local-development-key") {
				t.Errorf("seed env = %v, want the local API key", sup.envs[1])
			}
			if strings.Contains(joined, "HAVEN_SEED_PRESET") {
				t.Errorf("seed env = %v, want no preset without --demo", sup.envs[1])
			}
			if !strings.Contains(joined, "DATABASE_URL=") {
				t.Errorf("seed env = %v, want the rebuilt managed DATABASE_URL", sup.envs[1])
			}
		})
	})

	t.Run("given the seed run also flips the dev feature flags on", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := dbOrchestrator(sup, &fakeStore{}, &fakeSystem{}, &fakeDBServer{}, &fakeDBServer{})
		if err := o.DBReset(context.Background(), params, DBResetOptions{}); err != nil {
			t.Fatalf("DBReset: %v", err)
		}
		shell := sup.shells[1]
		if !strings.Contains(shell, `INSERT INTO "FeatureFlag"`) {
			t.Errorf("shell = %q, want the feature-flag upsert appended", shell)
		}
		for _, key := range domain.SeededFeatureFlags {
			if !strings.Contains(shell, key) {
				t.Errorf("shell = %q, want it to enable %q", shell, key)
			}
		}
		// Runtime opt-out gate so HAVEN_SEED_FEATURE_FLAGS=0 skips the upsert,
		// and best-effort so a missing psql never fails the seed.
		if !strings.Contains(shell, `"$HAVEN_SEED_FEATURE_FLAGS" != "0"`) {
			t.Errorf("shell = %q, want the opt-out gate", shell)
		}
		if !strings.Contains(shell, "|| echo") {
			t.Errorf("shell = %q, want the upsert to be best-effort", shell)
		}
	})

	t.Run("given a database drop fails", func(t *testing.T) {
		sup := &fakeSupervisor{}
		ch := &fakeDBServer{dropErr: errors.New("ch boom")}
		o := dbOrchestrator(sup, &fakeStore{}, &fakeSystem{}, ch, &fakeDBServer{})

		t.Run("when resetting, it fails hard and nothing is rebuilt", func(t *testing.T) {
			err := o.DBReset(context.Background(), params, DBResetOptions{})
			if err == nil || !strings.Contains(err.Error(), "clickhouse") {
				t.Fatalf("expected the drop failure to propagate, got %v", err)
			}
			if len(sup.shells) != 0 {
				t.Errorf("nothing may run after a failed drop, got %v", sup.shells)
			}
		})
	})

	t.Run("given migrations fail on the fresh database", func(t *testing.T) {
		sup := &fakeSupervisor{err: errors.New("migrate boom"), errOn: "start:prepare:db"}
		o := dbOrchestrator(sup, &fakeStore{}, &fakeSystem{}, &fakeDBServer{}, &fakeDBServer{})

		t.Run("when resetting, the error propagates and the seed never runs", func(t *testing.T) {
			err := o.DBReset(context.Background(), params, DBResetOptions{})
			if err == nil || !strings.Contains(err.Error(), "migrations failed") {
				t.Fatalf("expected the migration failure, got %v", err)
			}
			if len(sup.shells) != 1 {
				t.Errorf("shells = %v, want only the failed prepare", sup.shells)
			}
		})
	})

	t.Run("given the seed process fails", func(t *testing.T) {
		sup := &fakeSupervisor{err: errors.New("seed boom"), errOn: "prisma:seed"}
		o := dbOrchestrator(sup, liveStackStore(), &fakeSystem{alive: map[int]bool{42: true}}, &fakeDBServer{}, &fakeDBServer{})

		t.Run("when resetting with demo, the error propagates and traces never run", func(t *testing.T) {
			err := o.DBReset(context.Background(), params, DBResetOptions{Demo: true})
			if err == nil || !strings.Contains(err.Error(), "seed failed") {
				t.Fatal("expected the seed error to propagate")
			}
			if len(sup.shells) != 2 {
				t.Errorf("shells = %v, want prepare then the failed seed only", sup.shells)
			}
		})
	})

	t.Run("given demo with the stack not running", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := dbOrchestrator(sup, &fakeStore{}, &fakeSystem{}, &fakeDBServer{}, &fakeDBServer{})

		t.Run("when resetting, the seed carries the preset but traces are refused with the retry command", func(t *testing.T) {
			err := o.DBReset(context.Background(), params, DBResetOptions{Demo: true})
			if err == nil || !strings.Contains(err.Error(), "not running") {
				t.Fatalf("expected a stack-not-running error, got %v", err)
			}
			if !strings.Contains(err.Error(), "haven db reset --demo") {
				t.Errorf("err = %v, want the retry command", err)
			}
			if len(sup.shells) != 2 {
				t.Fatalf("shells = %v, want prepare + seed before the trace refusal", sup.shells)
			}
			if !strings.Contains(strings.Join(sup.envs[1], " "), "HAVEN_SEED_PRESET=demo") {
				t.Errorf("seed env = %v, want the demo preset", sup.envs[1])
			}
		})
	})

	t.Run("given demo with a live stack whose app port is not answering", func(t *testing.T) {
		sup := &fakeSupervisor{}
		sys := &portSystem{fakeSystem: fakeSystem{alive: map[int]bool{42: true}}, portsUp: map[int]bool{}}
		o := dbOrchestrator(sup, liveStackStore(), sys, &fakeDBServer{}, &fakeDBServer{})

		t.Run("when resetting, traces are refused", func(t *testing.T) {
			err := o.DBReset(context.Background(), params, DBResetOptions{Demo: true})
			if err == nil || !strings.Contains(err.Error(), "not answering") {
				t.Fatalf("expected a not-answering refusal, got %v", err)
			}
			if len(sup.shells) != 2 {
				t.Errorf("shells = %v, want prepare + seed only", sup.shells)
			}
		})
	})

	t.Run("given demo with a live, answering stack", func(t *testing.T) {
		sup := &fakeSupervisor{}
		sys := &portSystem{fakeSystem: fakeSystem{alive: map[int]bool{42: true}}, portsUp: map[int]bool{5560: true}}
		o := dbOrchestrator(sup, liveStackStore(), sys, &fakeDBServer{}, &fakeDBServer{})

		t.Run("when resetting, demo data is ingested through the app's loopback port", func(t *testing.T) {
			if err := o.DBReset(context.Background(), params, DBResetOptions{Demo: true}); err != nil {
				t.Fatalf("DBReset: %v", err)
			}
			if len(sup.shells) != 4 {
				t.Fatalf("shells = %v, want prepare, seed, sample-traces, realistic-platform", sup.shells)
			}
			if !strings.Contains(sup.shells[2], "seed:sample-traces") {
				t.Fatalf("shells = %v, want seed:sample-traces third", sup.shells)
			}
			if !strings.Contains(sup.shells[3], "seed:realistic-platform") {
				t.Fatalf("shells = %v, want seed:realistic-platform fourth", sup.shells)
			}
			joined := strings.Join(sup.envs[2], " ")
			if !strings.Contains(joined, "HAVEN_SEED_ENDPOINT=http://127.0.0.1:5560") {
				t.Errorf("traces env should point at the app's loopback port, got %v", sup.envs[2])
			}
			if !strings.Contains(joined, "HAVEN_SEED_LANGWATCH_API_KEY=sk-lw-local-development-key") {
				t.Errorf("traces env should carry the local ingestion key, got %v", sup.envs[2])
			}
			if strings.Join(sup.envs[3], " ") != joined {
				t.Errorf("platform seed should receive the same isolated stack overlay")
			}
		})
	})

	t.Run("given demo with a live stack whose only app service is a baseline fallback", func(t *testing.T) {
		sup := &fakeSupervisor{}
		store := &fakeStore{stacks: []domain.Stack{{
			Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: 42,
			PostgresPort: 1, PostgresDatabase: "lw_feat_x",
			Services: []domain.Service{{Name: "app", Port: 5560, IsFallback: true}},
		}}}
		sys := &portSystem{fakeSystem: fakeSystem{alive: map[int]bool{42: true}}, portsUp: map[int]bool{5560: true}}
		o := dbOrchestrator(sup, store, sys, &fakeDBServer{}, &fakeDBServer{})

		t.Run("when resetting, the fallback app is not a local target so traces are refused", func(t *testing.T) {
			err := o.DBReset(context.Background(), params, DBResetOptions{Demo: true})
			if err == nil || !strings.Contains(err.Error(), "not answering") {
				t.Fatalf("expected a not-answering refusal, got %v", err)
			}
		})
	})

	t.Run("given database management is disabled entirely", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := dbOrchestrator(sup, &fakeStore{}, &fakeSystem{}, &fakeDBServer{}, &fakeDBServer{})
		o.cfg.ShouldManageClickHouse, o.cfg.ShouldManagePostgres = false, false

		t.Run("when resetting, it refuses and nothing runs", func(t *testing.T) {
			err := o.DBReset(context.Background(), params, DBResetOptions{})
			if err == nil || !strings.Contains(err.Error(), "disabled") {
				t.Fatalf("expected the disabled refusal, got %v", err)
			}
			if len(sup.shells) != 0 {
				t.Errorf("nothing may run, got %v", sup.shells)
			}
		})
	})
}

// @scenario "Connection strings come from one place"
func TestDBURLRejectsUnknownEngine(t *testing.T) {
	o := dbOrchestrator(&fakeSupervisor{}, &fakeStore{}, &fakeSystem{}, &fakeDBServer{}, &fakeDBServer{})
	err := o.DBURL(context.Background(), UpParams{ExplicitSlug: "feat-x"}, "mysql")
	if err == nil || !strings.Contains(err.Error(), "postgres, clickhouse, or redis") {
		t.Fatalf("expected the engine list, got %v", err)
	}
}

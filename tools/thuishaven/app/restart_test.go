package app

import (
	"context"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func restartStack() domain.Stack {
	return domain.Stack{
		Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: 42,
		APIPort: 9100, WorkerMetricsPort: 9200, HasStandaloneWorkers: true,
		Services: []domain.Service{
			{Name: "app", Port: 9000},
			{Name: "gateway", Port: 9001},
			{Name: "nlp", Port: 9002, IsFallback: true}, // baseline fallback — not ours to bounce
			{Name: "clickhouse", Port: 8123},            // shared DB server — never a restart target
		},
	}
}

// inProcessWorkersStack is restartStack in the default in-process worker mode:
// WorkerMetricsPort is set (the API child binds it) but HasStandaloneWorkers is
// false, so there is no separate workers lane to bounce.
func inProcessWorkersStack() domain.Stack {
	st := restartStack()
	st.HasStandaloneWorkers = false
	return st
}

func restartOrch(store *fakeStore, sys *fakeSystem) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming("")},
		store: store, sys: sys, proxy: &fakeProxy{}, log: zap.NewNop(),
	}
}

// @scenario "Restarting one service bounces only that service"
// @scenario "Restarting with no service named bounces every supervised child"
func TestRestart(t *testing.T) {
	ctx := context.Background()
	params := UpParams{WorktreeDir: "/wt/feat-x", IsLinkedWorktree: true}

	newFixture := func() (*fakeStore, *fakeSystem, *Orchestrator) {
		store := &fakeStore{
			stacks:    []domain.Stack{restartStack()},
			slugCache: map[string]string{"/wt/feat-x": "feat-x"},
		}
		sys := &fakeSystem{
			alive: map[int]bool{42: true},
			pidsByPort: map[int][]int{
				9000: {100}, 9001: {101}, 9100: {102}, 9200: {103},
			},
		}
		return store, sys, restartOrch(store, sys)
	}

	t.Run("given a live stack", func(t *testing.T) {
		t.Run("when restarting one service, it kills only that service's group", func(t *testing.T) {
			_, sys, o := newFixture()
			if err := o.Restart(ctx, params, "gateway", false); err != nil {
				t.Fatalf("Restart: %v", err)
			}
			if len(sys.groupTerminated) != 1 || sys.groupTerminated[0] != 101 {
				t.Errorf("only gateway's group should be terminated, got %v", sys.groupTerminated)
			}
		})

		t.Run("when restarting the api, it resolves the API backend port", func(t *testing.T) {
			_, sys, o := newFixture()
			if err := o.Restart(ctx, params, "api", false); err != nil {
				t.Fatalf("Restart: %v", err)
			}
			if len(sys.groupTerminated) != 1 || sys.groupTerminated[0] != 102 {
				t.Errorf("api backend group should be terminated, got %v", sys.groupTerminated)
			}
		})

		t.Run("when restarting with no service named, it bounces every supervised child", func(t *testing.T) {
			_, sys, o := newFixture()
			if err := o.Restart(ctx, params, "", false); err != nil {
				t.Fatalf("Restart: %v", err)
			}
			// app, gateway, api, workers — NOT the fallback nlp, NOT clickhouse.
			want := map[int]bool{100: true, 101: true, 102: true, 103: true}
			if len(sys.groupTerminated) != len(want) {
				t.Fatalf("expected %d groups terminated, got %v", len(want), sys.groupTerminated)
			}
			for _, pid := range sys.groupTerminated {
				if !want[pid] {
					t.Errorf("unexpected group %d terminated", pid)
				}
			}
		})

		t.Run("when naming an unknown or shared service, it refuses with the restartable list", func(t *testing.T) {
			for _, name := range []string{"clickhouse", "nlp", "bogus"} {
				_, sys, o := newFixture()
				if err := o.Restart(ctx, params, name, false); err == nil {
					t.Errorf("Restart(%q) should refuse", name)
				}
				if len(sys.groupTerminated) != 0 {
					t.Errorf("Restart(%q) must terminate nothing, got %v", name, sys.groupTerminated)
				}
			}
		})

		t.Run("when the launcher itself owns the port, it is never signalled", func(t *testing.T) {
			store, sys, _ := newFixture()
			sys.pidsByPort[9000] = []int{42}
			o := restartOrch(store, sys)
			if err := o.Restart(ctx, params, "app", false); err != nil {
				t.Fatalf("Restart: %v", err)
			}
			if len(sys.groupTerminated) != 0 {
				t.Errorf("the launcher's own pid must never be group-terminated, got %v", sys.groupTerminated)
			}
		})

		t.Run("when workers run in-process, `workers` is not a restart target", func(t *testing.T) {
			// Default haven mode: the API child hosts the workers and holds
			// WorkerMetricsPort itself, so `restart workers` must refuse rather than
			// terminate the API's group; `restart` (all) must not touch it either.
			store := &fakeStore{
				stacks:    []domain.Stack{inProcessWorkersStack()},
				slugCache: map[string]string{"/wt/feat-x": "feat-x"},
			}
			sys := &fakeSystem{
				alive:      map[int]bool{42: true},
				pidsByPort: map[int][]int{9000: {100}, 9001: {101}, 9100: {102}, 9200: {102}},
			}
			o := restartOrch(store, sys)

			if err := o.Restart(ctx, params, "workers", false); err == nil {
				t.Error("restart workers should refuse in in-process mode")
			}
			if len(sys.groupTerminated) != 0 {
				t.Errorf("restart workers must terminate nothing in in-process mode, got %v", sys.groupTerminated)
			}

			if err := o.Restart(ctx, params, "", false); err != nil {
				t.Fatalf("Restart(all): %v", err)
			}
			// app, gateway, api — NOT workers (its port belongs to the API child).
			for _, pid := range sys.groupTerminated {
				if pid == 103 {
					t.Errorf("workers group must not be bounced in in-process mode")
				}
			}
			want := map[int]bool{100: true, 101: true, 102: true}
			if len(sys.groupTerminated) != len(want) {
				t.Fatalf("expected %d groups terminated, got %v", len(want), sys.groupTerminated)
			}
		})
	})

	t.Run("given the stack is not running", func(t *testing.T) {
		t.Run("when restarting, it refuses and points at up", func(t *testing.T) {
			store, sys, _ := newFixture()
			sys.alive = map[int]bool{}
			o := restartOrch(store, sys)
			if err := o.Restart(ctx, params, "app", false); err == nil {
				t.Error("Restart should refuse when the launcher is dead")
			}
		})
	})
}

// @scenario "Up on an already-running stack reconciles"
// @scenario "Up recovers a half-dead stack without a force flag"
func TestUpReconcilesRunningStack(t *testing.T) {
	params := UpParams{WorktreeDir: "/wt/feat-x", IsLinkedWorktree: true}

	newFixture := func(launcherAlive bool) (*fakeStore, *fakeSystem, *Orchestrator) {
		store := &fakeStore{
			stacks:    []domain.Stack{restartStack()},
			slugCache: map[string]string{"/wt/feat-x": "feat-x"},
		}
		sys := &fakeSystem{alive: map[int]bool{42: launcherAlive}}
		return store, sys, restartOrch(store, sys)
	}

	t.Run("given the stack is live and matches the selection", func(t *testing.T) {
		t.Run("when up runs, it is a friendly no-op — nothing terminated, nothing provisioned", func(t *testing.T) {
			store, sys, o := newFixture(true)
			opts := PlanOptions{Selection: domain.SelectionFromStack(store.stacks[0]), ShouldStartWorkers: true}
			proceed, err := o.reconcileRunningStack(params, opts)
			if err != nil {
				t.Fatalf("reconcile: %v", err)
			}
			if proceed {
				t.Error("a matching live stack must not be re-provisioned")
			}
			if len(sys.terminated) != 0 {
				t.Errorf("nothing may be terminated, got %v", sys.terminated)
			}
		})
	})

	t.Run("given the stack is live with a different selection", func(t *testing.T) {
		t.Run("when up runs, the old launcher is replaced without any force flag", func(t *testing.T) {
			store, sys, o := newFixture(true)
			desired := domain.SelectionFromStack(store.stacks[0])
			desired.Langy = !desired.Langy
			proceed, err := o.reconcileRunningStack(params, PlanOptions{Selection: desired, ShouldStartWorkers: true})
			if err != nil {
				t.Fatalf("reconcile: %v", err)
			}
			if !proceed {
				t.Error("a selection change must re-provision")
			}
			if len(sys.terminated) != 1 || sys.terminated[0] != 42 {
				t.Errorf("the old launcher must be terminated, got %v", sys.terminated)
			}
		})
	})

	t.Run("given a matching live stack and -f", func(t *testing.T) {
		t.Run("when up runs with force, the stack is replaced anyway", func(t *testing.T) {
			store, sys, o := newFixture(true)
			opts := PlanOptions{Selection: domain.SelectionFromStack(store.stacks[0]), ShouldStartWorkers: true, ShouldForce: true}
			proceed, err := o.reconcileRunningStack(params, opts)
			if err != nil {
				t.Fatalf("reconcile: %v", err)
			}
			if !proceed {
				t.Error("-f must re-provision even a matching stack")
			}
			if len(sys.terminated) != 1 {
				t.Errorf("-f must terminate the old launcher, got %v", sys.terminated)
			}
		})
	})

	t.Run("given the registered stack's launcher already exited", func(t *testing.T) {
		t.Run("when up runs, the stale entry is cleaned and provisioning proceeds", func(t *testing.T) {
			store, sys, o := newFixture(false)
			proceed, err := o.reconcileRunningStack(params, PlanOptions{ShouldStartWorkers: true})
			if err != nil {
				t.Fatalf("a dead launcher must not block up: %v", err)
			}
			if !proceed {
				t.Error("a dead launcher must not block provisioning")
			}
			if len(sys.terminated) != 0 {
				t.Errorf("nothing to terminate, got %v", sys.terminated)
			}
			if len(store.stacks) != 0 {
				t.Errorf("the stale registry entry must be cleaned, got %v", store.stacks)
			}
		})
	})
}

// @scenario "Down keeps the databases, always"
func TestDownKeepsDatabases(t *testing.T) {
	ctx := context.Background()
	params := UpParams{WorktreeDir: "/wt/feat-x", IsLinkedWorktree: true}
	store := &fakeStore{
		stacks:    []domain.Stack{restartStack()},
		slugCache: map[string]string{"/wt/feat-x": "feat-x"},
	}
	sys := &fakeSystem{alive: map[int]bool{42: true}}
	ch := &fakeDBServer{databases: []string{"lw_feat_x"}}
	pg := &fakeDBServer{databases: []string{"lw_feat_x"}}
	o := &Orchestrator{
		cfg:   Config{ShouldManageClickHouse: true, ShouldManagePostgres: true, Naming: domain.DefaultNaming("")},
		store: store, sys: sys, proxy: &fakeProxy{}, ch: ch, pg: pg, log: zap.NewNop(),
	}

	t.Run("when downing, databases are kept and the launcher is stopped", func(t *testing.T) {
		if err := o.Down(ctx, params, false); err != nil {
			t.Fatalf("Down: %v", err)
		}
		if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
			t.Errorf("down must never drop databases, got ch=%v pg=%v", ch.dropped, pg.dropped)
		}
		if len(sys.terminated) != 1 || sys.terminated[0] != 42 {
			t.Errorf("down should stop the live launcher, got %v", sys.terminated)
		}
		if len(store.stacks) != 0 {
			t.Errorf("the registry entry must be removed, got %v", store.stacks)
		}
	})
}

// @scenario "Down -f kills hard"
func TestDownForceKillsHard(t *testing.T) {
	ctx := context.Background()
	params := UpParams{WorktreeDir: "/wt/feat-x", IsLinkedWorktree: true}
	store := &fakeStore{
		stacks:    []domain.Stack{restartStack()},
		slugCache: map[string]string{"/wt/feat-x": "feat-x"},
	}
	sys := &fakeSystem{alive: map[int]bool{42: true}}
	o := &Orchestrator{
		cfg:   Config{ShouldManageClickHouse: true, ShouldManagePostgres: true, Naming: domain.DefaultNaming("")},
		store: store, sys: sys, proxy: &fakeProxy{}, ch: &fakeDBServer{}, pg: &fakeDBServer{}, log: zap.NewNop(),
	}

	t.Run("when downing with force, the launcher group is SIGKILLed with no graceful wait", func(t *testing.T) {
		if err := o.Down(ctx, params, true); err != nil {
			t.Fatalf("Down: %v", err)
		}
		if len(sys.groupKilled) != 1 || sys.groupKilled[0] != 42 {
			t.Errorf("force must kill the launcher group, got killed=%v", sys.groupKilled)
		}
		if len(sys.terminated) != 0 {
			t.Errorf("force must not bother with SIGTERM, got %v", sys.terminated)
		}
	})
}

// @scenario "The daemon prunes databases idle past the TTL"
func TestPruneIdleDatabases(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	ttl := 14 * 24 * time.Hour

	newOrch := func(activity map[string]time.Time, stacks []domain.Stack) (*fakeStore, *fakeDBServer, *fakeDBServer, *Orchestrator) {
		store := &fakeStore{stacks: stacks, dbActivity: activity}
		ch := &fakeDBServer{databases: []string{"lw_idle", "lw_fresh", "lw_main"}}
		pg := &fakeDBServer{databases: []string{"lw_idle", "lw_fresh", "lw_main"}}
		o := &Orchestrator{
			cfg:   Config{DBIdleTTL: ttl, ShouldManageClickHouse: true, ShouldManagePostgres: true, Naming: domain.DefaultNaming("")},
			store: store, sys: &fakeSystem{now: now}, proxy: &fakeProxy{}, ch: ch, pg: pg, log: zap.NewNop(),
		}
		return store, ch, pg, o
	}

	t.Run("given one slug idle past the TTL and one fresh", func(t *testing.T) {
		t.Run("when the daemon prunes, only the idle slug's databases are dropped", func(t *testing.T) {
			store, ch, pg, o := newOrch(map[string]time.Time{
				"idle":  now.Add(-ttl - time.Hour),
				"fresh": now.Add(-time.Hour),
			}, nil)
			o.pruneIdleDatabases(ctx)
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_idle" {
				t.Errorf("only the idle clickhouse db should drop, got %v", ch.dropped)
			}
			if len(pg.dropped) != 1 || pg.dropped[0] != "lw_idle" {
				t.Errorf("only the idle postgres db should drop, got %v", pg.dropped)
			}
			if _, ok := store.dbActivity["idle"]; ok {
				t.Error("the pruned slug's activity record should be removed")
			}
			if _, ok := store.dbActivity["fresh"]; !ok {
				t.Error("the fresh slug's activity record should remain")
			}
		})
	})

	t.Run("given an idle slug that still has a registered stack", func(t *testing.T) {
		t.Run("when the daemon prunes, its databases survive", func(t *testing.T) {
			_, ch, pg, o := newOrch(
				map[string]time.Time{"idle": now.Add(-ttl - time.Hour)},
				[]domain.Stack{{Slug: "idle", LauncherPID: 9}},
			)
			o.pruneIdleDatabases(ctx)
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("a registered stack's databases must never be idle-pruned, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given the protected main database's slug is idle", func(t *testing.T) {
		t.Run("when the daemon prunes, lw_main survives", func(t *testing.T) {
			_, ch, pg, o := newOrch(map[string]time.Time{"main": now.Add(-ttl - time.Hour)}, nil)
			o.pruneIdleDatabases(ctx)
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("the protected main database must never be pruned, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given pruning is disabled (TTL 0)", func(t *testing.T) {
		t.Run("when the daemon prunes, nothing is touched", func(t *testing.T) {
			_, ch, pg, o := newOrch(map[string]time.Time{"idle": now.Add(-1000 * time.Hour)}, nil)
			o.cfg.DBIdleTTL = 0
			o.pruneIdleDatabases(ctx)
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("TTL 0 disables pruning, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})
}

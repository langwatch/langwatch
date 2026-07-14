package app

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// --- fakes -------------------------------------------------------------------

type fakeStore struct {
	stacks    []domain.Stack
	removed   []string
	slugCache map[string]string
}

func (f *fakeStore) SaveStack(domain.Stack) error { return nil }
func (f *fakeStore) RemoveStack(slug string) {
	f.removed = append(f.removed, slug)
	var kept []domain.Stack
	for _, s := range f.stacks {
		if s.Slug != slug {
			kept = append(kept, s)
		}
	}
	f.stacks = kept
}
func (f *fakeStore) Stacks() []domain.Stack      { return f.stacks }
func (f *fakeStore) TakenSlugs() map[string]bool { return nil }
func (f *fakeStore) ReadSlugCache(dir string) (string, bool) {
	s, ok := f.slugCache[dir]
	return s, ok
}
func (f *fakeStore) WriteSlugCache(string, string) error     { return nil }
func (f *fakeStore) WriteOverlay(string, domain.Stack) error { return nil }
func (f *fakeStore) WriteHMRGate(string, int64) error        { return nil }
func (f *fakeStore) ReadHMRGate(string) (int64, bool)        { return 0, false }
func (f *fakeStore) ClearHMRGate(string)                     {}
func (f *fakeStore) ClaimDaemon(DaemonInfo) (bool, error)    { return true, nil }
func (f *fakeStore) Daemon() (DaemonInfo, bool)              { return DaemonInfo{}, false }
func (f *fakeStore) ClearDaemon()                            {}

type fakeSystem struct {
	alive      map[int]bool
	terminated []int
}

func (f *fakeSystem) FreePorts(n int) ([]int, error) { return make([]int, n), nil }
func (f *fakeSystem) PortInUse(int) bool             { return false }
func (f *fakeSystem) ProcessAlive(pid int) bool      { return f.alive[pid] }
func (f *fakeSystem) Terminate(pid int) {
	f.terminated = append(f.terminated, pid)
	// A terminated launcher dies with its process group; reflect that so the
	// bounded wait in DestroyWorktree observes the exit instead of spinning.
	if f.alive != nil {
		f.alive[pid] = false
	}
}
func (f *fakeSystem) SpawnDetached([]string, string, string) error { return nil }
func (f *fakeSystem) Now() time.Time                               { return time.Time{} }
func (f *fakeSystem) Getpid() int                                  { return 1 }
func (f *fakeSystem) TotalMemory() uint64                          { return 0 }
func (f *fakeSystem) GroupRSS(int) uint64                          { return 0 }

type fakeProxy struct{ removed []string }

func (f *fakeProxy) Register(string, string, int) error { return nil }
func (f *fakeProxy) Remove(service, slug string)        { f.removed = append(f.removed, service+"."+slug) }
func (f *fakeProxy) Running() bool                      { return true }
func (f *fakeProxy) Installed() bool                    { return true }
func (f *fakeProxy) EnsureReady() error                 { return nil }
func (f *fakeProxy) Endpoint() (string, int)            { return "https", 443 }

type fakeDBServer struct {
	databases []string
	dropped   []string
}

func (f *fakeDBServer) Ensure(context.Context) (int, error)               { return 1, nil }
func (f *fakeDBServer) EnsureDatabase(_ context.Context, db string) error { return nil }
func (f *fakeDBServer) DropDatabase(_ context.Context, db string) error {
	f.dropped = append(f.dropped, db)
	return nil
}
func (f *fakeDBServer) Databases(context.Context) ([]string, error) { return f.databases, nil }
func (f *fakeDBServer) HTTPPort() int                               { return 0 }
func (f *fakeDBServer) Port() int                                   { return 0 }
func (f *fakeDBServer) Running() bool                               { return true }
func (f *fakeDBServer) Health(context.Context) (bool, string)       { return true, "" }
func (f *fakeDBServer) Stop()                                       {}

type fakeHygiene struct {
	worktrees        []Worktree
	removedWorktrees []string
}

func (f *fakeHygiene) Worktrees(string) ([]Worktree, error) { return f.worktrees, nil }
func (f *fakeHygiene) Dirty(string) bool                    { return false }
func (f *fakeHygiene) DirSize(string) (int64, bool)         { return 0, false }
func (f *fakeHygiene) Remove(string) error                  { return nil }
func (f *fakeHygiene) PruneGitWorktrees(string)             {}
func (f *fakeHygiene) RemoveWorktree(_, dir string) error {
	f.removedWorktrees = append(f.removedWorktrees, dir)
	return nil
}

func hubOrchestrator(store *fakeStore, sys *fakeSystem, proxy *fakeProxy, ch, pg *fakeDBServer, hyg *fakeHygiene) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{ShouldManageClickHouse: true, ShouldManagePostgres: true, Naming: domain.DefaultNaming("")},
		store: store, sys: sys, proxy: proxy, ch: ch, pg: pg, hyg: hyg,
		log: zap.NewNop(),
	}
}

// --- DownStack ----------------------------------------------------------------

func TestDownStack(t *testing.T) {
	t.Run("given a live registered stack", func(t *testing.T) {
		store := &fakeStore{stacks: []domain.Stack{{
			Slug: "feat-x", LauncherPID: 42,
			Services: []domain.Service{{Name: "app"}, {Name: "clickhouse"}},
		}}}
		sys := &fakeSystem{alive: map[int]bool{42: true}}
		proxy := &fakeProxy{}
		ch := &fakeDBServer{databases: []string{"lw_feat_x"}}
		pg := &fakeDBServer{databases: []string{"lw_feat_x"}}
		o := hubOrchestrator(store, sys, proxy, ch, pg, &fakeHygiene{})

		t.Run("when downed, it stops the launcher and removes routes and registry entry", func(t *testing.T) {
			if err := o.DownStack(context.Background(), "feat-x"); err != nil {
				t.Fatalf("DownStack: %v", err)
			}
			if len(sys.terminated) != 1 || sys.terminated[0] != 42 {
				t.Errorf("launcher should be terminated, got %v", sys.terminated)
			}
			if len(proxy.removed) != 2 {
				t.Errorf("all service routes should be removed, got %v", proxy.removed)
			}
			if len(store.removed) != 1 || store.removed[0] != "feat-x" {
				t.Errorf("registry entry should be removed, got %v", store.removed)
			}
			// Down keeps data — only DestroyWorktree drops databases. This guards
			// the load-bearing distinction: nothing should drop a database on down.
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("down must keep databases, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given a stack whose launcher already exited", func(t *testing.T) {
		store := &fakeStore{stacks: []domain.Stack{{Slug: "stale", LauncherPID: 7}}}
		sys := &fakeSystem{alive: map[int]bool{}}
		o := hubOrchestrator(store, sys, &fakeProxy{}, &fakeDBServer{}, &fakeDBServer{}, &fakeHygiene{})

		t.Run("when downed, it cleans up without signalling a dead pid", func(t *testing.T) {
			if err := o.DownStack(context.Background(), "stale"); err != nil {
				t.Fatalf("DownStack: %v", err)
			}
			if len(sys.terminated) != 0 {
				t.Errorf("no signal should be sent to a dead launcher, got %v", sys.terminated)
			}
		})
	})

	t.Run("given no stack with that slug", func(t *testing.T) {
		o := hubOrchestrator(&fakeStore{}, &fakeSystem{}, &fakeProxy{}, &fakeDBServer{}, &fakeDBServer{}, &fakeHygiene{})

		t.Run("when downed, it fails", func(t *testing.T) {
			if err := o.DownStack(context.Background(), "ghost"); err == nil {
				t.Fatal("expected an error for an unknown slug")
			}
		})
	})
}

// --- DestroyWorktree ------------------------------------------------------------

func TestDestroyWorktree(t *testing.T) {
	primary := "/repos/langwatch"
	victim := "/repos/worktrees/feat-x"

	setup := func() (*fakeStore, *fakeSystem, *fakeProxy, *fakeDBServer, *fakeDBServer, *fakeHygiene, *Orchestrator) {
		store := &fakeStore{
			stacks:    []domain.Stack{{Slug: "feat-x", WorktreeDir: victim, LauncherPID: 42, Services: []domain.Service{{Name: "app"}}}},
			slugCache: map[string]string{victim: "feat-x"},
		}
		sys := &fakeSystem{alive: map[int]bool{42: true}}
		proxy := &fakeProxy{}
		ch := &fakeDBServer{databases: []string{"lw_feat_x", "lw_main"}}
		pg := &fakeDBServer{databases: []string{"lw_feat_x", "lw_main"}}
		hyg := &fakeHygiene{worktrees: []Worktree{{Dir: primary}, {Dir: victim}}}
		return store, sys, proxy, ch, pg, hyg, hubOrchestrator(store, sys, proxy, ch, pg, hyg)
	}

	t.Run("given a linked worktree with a running stack", func(t *testing.T) {
		_, sys, _, ch, pg, hyg, o := setup()

		t.Run("when destroyed, it downs the stack, drops both databases, and removes the worktree", func(t *testing.T) {
			if err := o.DestroyWorktree(context.Background(), primary, victim, primary); err != nil {
				t.Fatalf("DestroyWorktree: %v", err)
			}
			if len(sys.terminated) != 1 {
				t.Errorf("launcher should be stopped, got %v", sys.terminated)
			}
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_feat_x" {
				t.Errorf("clickhouse db should be dropped, got %v", ch.dropped)
			}
			if len(pg.dropped) != 1 || pg.dropped[0] != "lw_feat_x" {
				t.Errorf("postgres db should be dropped, got %v", pg.dropped)
			}
			if len(hyg.removedWorktrees) != 1 || hyg.removedWorktrees[0] != victim {
				t.Errorf("worktree should be removed, got %v", hyg.removedWorktrees)
			}
		})
	})

	t.Run("given the target is the primary checkout", func(t *testing.T) {
		_, _, _, _, _, hyg, o := setup()

		t.Run("when destroyed, it refuses", func(t *testing.T) {
			err := o.DestroyWorktree(context.Background(), primary, primary, "/somewhere/else")
			if err == nil || !strings.Contains(err.Error(), "primary") {
				t.Fatalf("expected a primary-checkout refusal, got %v", err)
			}
			if len(hyg.removedWorktrees) != 0 {
				t.Error("nothing should be removed")
			}
		})
	})

	t.Run("given the target is the worktree haven runs from", func(t *testing.T) {
		_, _, _, _, _, hyg, o := setup()

		t.Run("when destroyed, it refuses", func(t *testing.T) {
			err := o.DestroyWorktree(context.Background(), primary, victim, victim)
			if err == nil || !strings.Contains(err.Error(), "running from") {
				t.Fatalf("expected a self refusal, got %v", err)
			}
			if len(hyg.removedWorktrees) != 0 {
				t.Error("nothing should be removed")
			}
		})
	})

	t.Run("given the target is not a worktree of the repository", func(t *testing.T) {
		_, _, _, _, _, _, o := setup()

		t.Run("when destroyed, it refuses", func(t *testing.T) {
			if err := o.DestroyWorktree(context.Background(), primary, "/tmp/random", primary); err == nil {
				t.Fatal("expected a not-a-worktree refusal")
			}
		})
	})

	t.Run("given the worktree's registered slug is the protected main database", func(t *testing.T) {
		store, _, _, ch, pg, _, _ := setup()
		// The slug is derived from the registry, not the worktree-local cache.
		store.stacks[0].Slug = "main"
		store.slugCache[victim] = "main"
		hyg := &fakeHygiene{worktrees: []Worktree{{Dir: primary}, {Dir: victim}}}
		o := hubOrchestrator(store, &fakeSystem{}, &fakeProxy{}, ch, pg, hyg)

		t.Run("when destroyed, lw_main is kept", func(t *testing.T) {
			if err := o.DestroyWorktree(context.Background(), primary, victim, primary); err != nil {
				t.Fatalf("DestroyWorktree: %v", err)
			}
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("protected database must never be dropped, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given a forged slug cache naming another worktree's slug", func(t *testing.T) {
		// A hostile branch ships .langwatch-slug naming a different, still-live
		// worktree; the registry (which haven controls) must win so the victim's
		// database is dropped and the innocent worktree's is left untouched.
		store, _, _, ch, pg, _, o := setup()
		store.slugCache[victim] = "other"
		store.stacks = append(store.stacks, domain.Stack{Slug: "other", WorktreeDir: "/repos/worktrees/other"})
		ch.databases = []string{"lw_feat_x", "lw_other", "lw_main"}
		pg.databases = []string{"lw_feat_x", "lw_other", "lw_main"}

		t.Run("when destroyed, it drops the registry slug's database, not the forged one", func(t *testing.T) {
			if err := o.DestroyWorktree(context.Background(), primary, victim, primary); err != nil {
				t.Fatalf("DestroyWorktree: %v", err)
			}
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_feat_x" {
				t.Errorf("should drop the registry slug's db only, got %v", ch.dropped)
			}
			if slices.Contains(pg.dropped, "lw_other") {
				t.Errorf("must not drop another worktree's database, got %v", pg.dropped)
			}
		})
	})
}
